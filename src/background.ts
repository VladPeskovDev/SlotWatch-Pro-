import Tesseract from 'tesseract.js';
import { MessageType, Message, MessageResponse, StorageData,
  ReferenceSnapshot,
  MonitoringConfig,
  TelegramConfig,
  ComparisonResult,
} from './types.js';

const DEFAULT_INTERVAL_MIN = 60; 
const DEFAULT_INTERVAL_MAX = 120; 
const DEFAULT_REFRESH_DELAY = 3000; 
const ALARM_NAME = 'slotwatch_monitor';

// Инициализация при установке расширения
chrome.runtime.onInstalled.addListener(() => {
  console.log('SlotWatch Pro installed');
  initializeStorage();
});

// Инициализация дефолтных настроек
async function initializeStorage() {
  const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;

  if (!data.monitoring) {
    const defaultConfig: MonitoringConfig = {
      isActive: false,
      intervalMin: DEFAULT_INTERVAL_MIN,
      intervalMax: DEFAULT_INTERVAL_MAX,
      autoRefresh: true,
      refreshDelay: DEFAULT_REFRESH_DELAY,
    };
    await chrome.storage.local.set({ monitoring: defaultConfig });
  }
}

// Обработка сообщений от popup
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; 
  }
);

// Маршрутизация сообщений
async function handleMessage(message: Message): Promise<MessageResponse> {
  switch (message.type) {
    case MessageType.CAPTURE_REFERENCE:
      return await captureReference();
    case MessageType.START_MONITORING:
      return await startMonitoring();
    case MessageType.STOP_MONITORING:
      return await stopMonitoring();
    case MessageType.GET_STATUS:
      return await getStatus();
    case MessageType.SAVE_SETTINGS:
      return await saveSettings(message.payload);
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// Захват эталонного снимка
async function captureReference(): Promise<MessageResponse> {
  try {
    // Получаем активную вкладку
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab found' };
    }

    // Делаем скриншот
    const screenshot = await chrome.tabs.captureVisibleTab({
      format: 'png',
    });

    // OCR распознавание
    const recognizedText = await performOCR(screenshot);

    // Получаем ключевые фразы
    const data = (await chrome.storage.local.get('keywords')) as Partial<StorageData>;
    const keyPhrases = data.keywords || [];

    // Сохраняем эталон
    const reference: ReferenceSnapshot = {
      url: tab.url || '',
      timestamp: Date.now(),
      screenshot,
      recognizedText,
      keyPhrases,
    };

    await chrome.storage.local.set({ reference });

    return { success: true, data: reference };
  } catch (error) {
    console.error('Capture error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// OCR распознавание текста
async function performOCR(imageData: string): Promise<string> {
  try {
    const result = await Tesseract.recognize(imageData, 'rus+eng', {
      logger: (m) => console.log(m),
    });
    return result.data.text;
  } catch (error) {
    console.error('OCR error:', error);
    throw new Error('Failed to recognize text');
  }
}

// Старт мониторинга
async function startMonitoring(): Promise<MessageResponse> {
  try {
    const data = (await chrome.storage.local.get([
      'reference',
      'telegram',
      'monitoring',
    ])) as Partial<StorageData>;

    if (!data.reference) {
      return { success: false, error: 'No reference snapshot captured' };
    }

    if (!data.telegram?.botToken || !data.telegram?.chatId) {
      return { success: false, error: 'Telegram settings not configured' };
    }

    // Обновляем статус
    const config: MonitoringConfig = {
      ...data.monitoring!,
      isActive: true,
    };
    await chrome.storage.local.set({ monitoring: config });

    // Запускаем alarm
    const intervalMinutes =
      getRandomInterval(config.intervalMin, config.intervalMax) / 60;
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Остановка мониторинга
async function stopMonitoring(): Promise<MessageResponse> {
  try {
    const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;

    const config: MonitoringConfig = {
      ...data.monitoring!,
      isActive: false,
    };
    await chrome.storage.local.set({ monitoring: config });

    await chrome.alarms.clear(ALARM_NAME);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Получение статуса
async function getStatus(): Promise<MessageResponse> {
  const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;
  return { success: true, data: data.monitoring };
}

// Сохранение настроек
async function saveSettings(payload: unknown): Promise<MessageResponse> {
  try {
    const settings = payload as {
      telegram: TelegramConfig;
      keywords: string[];
    };
    await chrome.storage.local.set(settings);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Обработка alarm 
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkForChanges();
  }
});

// Проверка изменений на странице
async function checkForChanges() {
  try {
    const data = (await chrome.storage.local.get([
      'reference',
      'telegram',
      'monitoring',
    ])) as Partial<StorageData>;

    if (!data.reference || !data.monitoring?.isActive) {
      return;
    }

    // Получаем вкладку с URL эталона
    const tabs = await chrome.tabs.query({});
    const targetTab = tabs.find((tab) => tab.url === data.reference!.url);
    if (!targetTab || !targetTab.id) {
      console.log('Target tab not found');
      return;
    }

    // Активируем нужную вкладку
    await chrome.tabs.update(targetTab.id, { active: true });


    if (data.monitoring?.autoRefresh) {
    await chrome.tabs.reload(targetTab.id);
    await new Promise((resolve) =>
    setTimeout(resolve, data.monitoring?.refreshDelay || DEFAULT_REFRESH_DELAY)
     );
     }

    // Делаем новый скриншот
    const screenshot = await chrome.tabs.captureVisibleTab({
      format: 'png',
    });

    // OCR распознавание
    const currentText = await performOCR(screenshot);

    // Сравниваем
    const comparison = compareTexts(
      data.reference.recognizedText,
      currentText,
      data.reference.keyPhrases
    );

    // Обновляем время последней проверки
    const config: MonitoringConfig = {
      ...data.monitoring,
      lastCheckTime: Date.now(),
    };
    await chrome.storage.local.set({ monitoring: config });

    // Если изменения обнаружены
    if (comparison.hasChanged) {
      await sendTelegramNotification(data.telegram!, comparison);
      await showBrowserNotification(comparison);
    }
  } catch (error) {
    console.error('Check error:', error);
  }
}

// Сравнение текстов
function compareTexts(
  referenceText: string,
  currentText: string,
  keyPhrases: string[]
): ComparisonResult {
  const missingPhrases: string[] = [];

  for (const phrase of keyPhrases) {
    const wasPresent = referenceText
      .toLowerCase()
      .includes(phrase.toLowerCase());
    const isPresent = currentText.toLowerCase().includes(phrase.toLowerCase());

    if (wasPresent && !isPresent) {
      missingPhrases.push(phrase);
    }
  }

  return {
    hasChanged: missingPhrases.length > 0,
    missingPhrases,
    detectedText: currentText,
  };
}

// Отправка уведомления в Telegram
async function sendTelegramNotification(
  config: TelegramConfig,
  comparison: ComparisonResult
) {
  const message = `SlotWatch Pro Alert!

Detected changes on the monitored page!

Missing phrases:
${comparison.missingPhrases.map((p) => `- ${p}`).join('\n')}

Slots may be available now! Check immediately.`;

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (error) {
    console.error('Telegram error:', error);
  }
}

// Браузерный алерт
async function showBrowserNotification(comparison: ComparisonResult) {
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SlotWatch Pro Alert!',
    message: `Changes detected! Missing: ${comparison.missingPhrases.join(', ')}`,
    priority: 2,
  });
}

// Рандомный интервал обновлений 
function getRandomInterval(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}