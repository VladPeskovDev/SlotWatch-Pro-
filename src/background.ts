import {
  MessageType,
  Message,
  MessageResponse,
  StorageData,
  TelegramConfig,
  MonitoringConfig,
} from './types.js';

const ALARM_NAME = 'slotwatch_cycle';
const DEFAULT_INTERVAL_MIN = 50;
const DEFAULT_INTERVAL_MAX = 120;
const MODAL_CLOSE_WAIT_MIN = 1500;
const MODAL_CLOSE_WAIT_MAX = 3500;
const AFTER_CLICK_WAIT_MIN = 18000;
const AFTER_CLICK_WAIT_MAX = 28000;

const BOOK_BUTTON_TEXT = 'Записаться на посещение';
const NO_SLOTS_TEXT = 'Нет свободного времени для записи';

chrome.runtime.onInstalled.addListener(() => {
  initializeStorage();
});

async function initializeStorage() {
  const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;
  if (!data.monitoring) {
    await chrome.storage.local.set({
      monitoring: {
        isActive: false,
        intervalMin: DEFAULT_INTERVAL_MIN,
        intervalMax: DEFAULT_INTERVAL_MAX,
        attemptCount: 0,
      },
    });
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
});

async function handleMessage(message: Message): Promise<MessageResponse> {
  switch (message.type) {
    case MessageType.START_MONITORING:
      return await startBot();
    case MessageType.STOP_MONITORING:
      return await stopBot();
    case MessageType.GET_STATUS:
      return await getStatus();
    case MessageType.SAVE_SETTINGS:
      return await saveSettings(message.payload);
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function startBot(): Promise<MessageResponse> {
  const data = (await chrome.storage.local.get(['telegram', 'monitoring'])) as Partial<StorageData>;

  if (!data.telegram?.botToken || !data.telegram?.chatId) {
    return { success: false, error: 'Настройте Telegram перед запуском' };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    return { success: false, error: 'Нет активной вкладки' };
  }

  const config: MonitoringConfig = {
    ...(data.monitoring || {}),
    isActive: true,
    intervalMin: data.monitoring?.intervalMin || DEFAULT_INTERVAL_MIN,
    intervalMax: data.monitoring?.intervalMax || DEFAULT_INTERVAL_MAX,
    targetUrl: tab.url,
    targetTabId: tab.id,
    attemptCount: 0,
  };
  await chrome.storage.local.set({ monitoring: config });

  await runCycle();
  return { success: true };
}

async function stopBot(): Promise<MessageResponse> {
  await chrome.alarms.clear(ALARM_NAME);
  const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;
  await chrome.storage.local.set({
    monitoring: {
      ...(data.monitoring || {}),
      isActive: false,
      intervalMin: data.monitoring?.intervalMin || DEFAULT_INTERVAL_MIN,
      intervalMax: data.monitoring?.intervalMax || DEFAULT_INTERVAL_MAX,
    },
  });
  return { success: true };
}

async function getStatus(): Promise<MessageResponse> {
  const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;
  return { success: true, data: data.monitoring };
}

async function saveSettings(payload: unknown): Promise<MessageResponse> {
  try {
    await chrome.storage.local.set(payload as object);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;
    if (data.monitoring?.isActive) {
      await runCycle();
    }
  }
});

async function runCycle() {
  const data = (await chrome.storage.local.get(['telegram', 'monitoring'])) as Partial<StorageData>;

  if (!data.monitoring?.isActive) return;

  const attemptCount = (data.monitoring.attemptCount || 0) + 1;
  const now = Date.now();
  const attemptLog = [...(data.monitoring.attemptLog || []), now].slice(-10);
  await chrome.storage.local.set({
    monitoring: { ...data.monitoring, lastCheckTime: now, attemptCount, attemptLog },
  });

  console.log(`Cycle #${attemptCount}`);

  try {
    const tabId = data.monitoring.targetTabId;
    const targetUrl = data.monitoring.targetUrl;

    if (!tabId) {
      await notifyError('Целевая вкладка не найдена. Перезапустите бота.');
      await stopBot();
      return;
    }

    try {
      await chrome.tabs.get(tabId);
    } catch {
      await notifyError('Вкладка была закрыта. Перезапустите бота.');
      await stopBot();
      return;
    }

    // Keepalive пинг — сбрасывает таймер сессии на сервере
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => fetch(window.location.href, { method: 'HEAD', credentials: 'include' }),
      });
    } catch { /* игнорируем */ }

    // Проверяем что мы на стартовой странице
    let onStartPage = false;
    try {
      const check = await chrome.scripting.executeScript({
        target: { tabId },
        func: (text: string) => document.body.innerText.includes(text),
        args: [BOOK_BUTTON_TEXT],
      });
      onStartPage = !!check[0]?.result;
    } catch {
      onStartPage = false;
    }

    // Если ушли со стартовой — возвращаемся
    if (!onStartPage && targetUrl) {
      console.log('Not on start page, navigating back...');
      await chrome.tabs.update(tabId, { url: targetUrl });
      await waitForTabLoad(tabId);
      await wait(getRandomInterval(1000, 2500));
    }

    // Жмём "Записаться на посещение"
    const clickResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: (text: string) => {
        const spans = Array.from(document.querySelectorAll('.answer-btn__title'));
        const byClass = spans.find((el) => el.textContent?.includes(text));
        if (byClass) {
          (byClass.closest('.answer-btn__container') as HTMLElement)?.click();
          return true;
        }
        const all = Array.from(document.querySelectorAll('a, button, [role="button"], div[class*="answer"]'));
        const byText = all.find((el) => el.textContent?.includes(text));
        if (byText) {
          (byText as HTMLElement).click();
          return true;
        }
        return false;
      },
      args: [BOOK_BUTTON_TEXT],
    });

    if (!clickResult[0]?.result) {
      await notifyError(`Кнопка "${BOOK_BUTTON_TEXT}" не найдена на странице`);
      await scheduleNextCycle(data.monitoring);
      return;
    }

    // Ждём пока спиннер точно закончится — рандом 13-17 сек
    const waitTime = getRandomInterval(AFTER_CLICK_WAIT_MIN, AFTER_CLICK_WAIT_MAX);
    console.log(`Waiting ${waitTime}ms for page to load...`);
    await wait(waitTime);

    // Один чек — смотрим что на экране
    const check = await chrome.scripting.executeScript({
      target: { tabId },
      func: (noSlotsText: string, bookText: string) => ({
        hasNoSlots: document.body.innerText.includes(noSlotsText),
        hasBookButton: document.body.innerText.includes(bookText),
      }),
      args: [NO_SLOTS_TEXT, BOOK_BUTTON_TEXT],
    });

    const result = check[0]?.result as { hasNoSlots: boolean; hasBookButton: boolean } | undefined;

    console.log('Check result:', result);

    if (result?.hasNoSlots) {
      // Мест нет — жмём "Закрыть" по CSS классу
      console.log('No slots. Closing modal...');
      await wait(500); // пауза чтобы кнопка точно стала кликабельной
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const btn = document.querySelector('button.white') as HTMLElement | null;
          btn?.click();
          return !!btn;
        },
      });
      await wait(getRandomInterval(MODAL_CLOSE_WAIT_MIN, MODAL_CLOSE_WAIT_MAX));
      await scheduleNextCycle(data.monitoring);

    } else if (!result?.hasBookButton) {
      // Стартовой кнопки нет и модалки нет — мы на экране бронирования!
      console.log('SLOTS FOUND!');
      await sendTelegram(
        data.telegram!,
        `🎯 SlotWatch Pro — Слоты найдены!\n\nПопытка #${attemptCount}\nЗаписывайтесь прямо сейчас!\n${targetUrl || ''}`
      );
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '🎯 SlotWatch — Слоты найдены!',
        message: 'Записывайтесь прямо сейчас!',
        priority: 2,
      });
      await stopBot();

    } else {
      // Всё ещё на стартовой — клик не сработал, пробуем снова
      console.log('Still on start page, retrying...');
      await scheduleNextCycle(data.monitoring);
    }

  } catch (error) {
    console.error('Cycle error:', error);
    await notifyError(error instanceof Error ? error.message : 'Неизвестная ошибка');
    const freshData = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;
    if (freshData.monitoring?.isActive) {
      await scheduleNextCycle(freshData.monitoring);
    }
  }
}

async function scheduleNextCycle(config: MonitoringConfig) {
  const seconds = getRandomInterval(config.intervalMin, config.intervalMax);
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: seconds / 60 });
  console.log(`Next cycle in ${seconds}s`);
}

async function waitForTabLoad(tabId: number, timeout = 8000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeout);
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo, _tab: chrome.tabs.Tab) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function notifyError(message: string) {
  const data = (await chrome.storage.local.get('telegram')) as Partial<StorageData>;
  if (data.telegram?.botToken && data.telegram?.chatId) {
    await sendTelegram(data.telegram, `⚠️ SlotWatch ошибка:\n${message}`);
  }
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SlotWatch — Ошибка',
    message,
    priority: 1,
  });
}

async function sendTelegram(config: TelegramConfig, text: string) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text }),
    });
    if (!response.ok) {
      console.error('Telegram error:', await response.text());
    }
  } catch (error) {
    console.error('Telegram error:', error);
  }
}

function getRandomInterval(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
