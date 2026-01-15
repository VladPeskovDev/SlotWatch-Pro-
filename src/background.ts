import {
  MessageType,
  Message,
  MessageResponse,
  StorageData,
  ReferenceSnapshot,
  MonitoringConfig,
  TelegramConfig,
  ComparisonResult,
} from './types.js';

// Константы
const DEFAULT_INTERVAL_MIN = 40; 
const DEFAULT_INTERVAL_MAX = 125; 
const DEFAULT_REFRESH_DELAY = 3000; 
const ALARM_NAME = 'slotwatch_monitor';
const CHANGE_THRESHOLD = 5; 

// Инициализация при установке расширения
chrome.runtime.onInstalled.addListener(() => {
  console.log('SlotWatch Pro installed');
  initializeStorage();
});

// Инициализация дефолтных настроек
async function initializeStorage() {
  const data = (await chrome.storage.local.get(
    'monitoring'
  )) as Partial<StorageData>;

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

    // Получаем ключевые фразы (пока не используются)
    const data = (await chrome.storage.local.get(
      'keywords'
    )) as Partial<StorageData>;
    const keyPhrases = data.keywords || [];

    // Сохраняем эталон
    const reference: ReferenceSnapshot = {
      url: tab.url || '',
      timestamp: Date.now(),
      screenshot,
      keyPhrases,
    };

    await chrome.storage.local.set({ reference });

    console.log('Reference captured successfully');
    return { success: true, data: reference };
  } catch (error) {
    console.error('Capture error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Конвертация base64 в ImageData
async function base64ToImageData(base64: string): Promise<ImageData> {
  try {
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    
    if (!base64Data) {
      throw new Error('Invalid base64 data');
    }
    
    // Декодируем base64 в бинарные данные
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Создаём Blob из бинарных данных
    const blob = new Blob([bytes], { type: 'image/png' });
    
    // Создаём ImageBitmap
    const imageBitmap = await createImageBitmap(blob);
    
    // Получаем ImageData через OffscreenCanvas
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }
    
    ctx.drawImage(imageBitmap, 0, 0);
    return ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
  } catch (error) {
    console.error('base64ToImageData error:', error);
    throw new Error('Unable to download all specified images');
  }
}

// Сравнение двух скриншотов
async function compareScreenshots(
  referenceBase64: string,
  currentBase64: string
): Promise<ComparisonResult> {
  try {
    const refImageData = await base64ToImageData(referenceBase64);
    const curImageData = await base64ToImageData(currentBase64);

    // Проверка размеров
    if (
      refImageData.width !== curImageData.width ||
      refImageData.height !== curImageData.height
    ) {
      console.warn('Screenshot dimensions differ');
      return {
        hasChanged: true,
        changePercentage: 100,
        detectedText: '',
        missingPhrases: ['Page layout changed'],
      };
    }

    const refData = refImageData.data;
    const curData = curImageData.data;
    let diffPixels = 0;
    const totalPixels = refData.length / 4; 

    // Сравниваем попиксельно (каждый 4й пиксель для скорости)
    for (let i = 0; i < refData.length - 3; i += 16) {
      if (i + 2 >= curData.length) break;

      // RGB сравнение (игнорируем альфа канал)
      const rDiff = Math.abs((refData[i] ?? 0) - (curData[i] ?? 0));
      const gDiff = Math.abs((refData[i + 1] ?? 0) - (curData[i + 1] ?? 0));
      const bDiff = Math.abs((refData[i + 2] ?? 0) - (curData[i + 2] ?? 0));

      // Если разница больше порога (игнорируем мелкие изменения)
      if (rDiff > 30 || gDiff > 30 || bDiff > 30) {
        diffPixels++;
      }
    }

    const sampledPixels = totalPixels / 4; 
    const changePercentage = (diffPixels / sampledPixels) * 100;

    console.log(`Change detected: ${changePercentage.toFixed(2)}%`);

    return {
      hasChanged: changePercentage > CHANGE_THRESHOLD,
      changePercentage: parseFloat(changePercentage.toFixed(2)),
      detectedText: '',
      missingPhrases:
        changePercentage > CHANGE_THRESHOLD ? ['Visual changes detected'] : [],
    };
  } catch (error) {
    console.error('Comparison error:', error);
    throw new Error('Failed to compare screenshots');
  }
}

// Старт мониторинга
async function startMonitoring(): Promise<MessageResponse> {
  try {
    // Проверяем наличие эталона
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
      ...(data.monitoring || {}),
      isActive: true,
      intervalMin: data.monitoring?.intervalMin || DEFAULT_INTERVAL_MIN,
      intervalMax: data.monitoring?.intervalMax || DEFAULT_INTERVAL_MAX,
      autoRefresh: data.monitoring?.autoRefresh ?? true,
      refreshDelay: data.monitoring?.refreshDelay || DEFAULT_REFRESH_DELAY,
    };
    await chrome.storage.local.set({ monitoring: config });

    // Запускаем alarm
    const intervalMinutes =
      getRandomInterval(config.intervalMin, config.intervalMax) / 60;
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes,
    });

    console.log('Monitoring started');
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
    const data = (await chrome.storage.local.get(
      'monitoring'
    )) as Partial<StorageData>;

    const config: MonitoringConfig = {
      ...(data.monitoring || {}),
      isActive: false,
      intervalMin: data.monitoring?.intervalMin || DEFAULT_INTERVAL_MIN,
      intervalMax: data.monitoring?.intervalMax || DEFAULT_INTERVAL_MAX,
      autoRefresh: data.monitoring?.autoRefresh ?? true,
      refreshDelay: data.monitoring?.refreshDelay || DEFAULT_REFRESH_DELAY,
    };
    await chrome.storage.local.set({ monitoring: config });

    await chrome.alarms.clear(ALARM_NAME);

    console.log('Monitoring stopped');
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
  const data = (await chrome.storage.local.get(
    'monitoring'
  )) as Partial<StorageData>;
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

// Обработка alarm (периодическая проверка)
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

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab || !activeTab.id) {
      console.log('No active tab found');
      return;
    }

    //console.log(`Checking tab: ${activeTab.url}`);

    // Обновляем страницу если включен auto-refresh
    if (data.monitoring?.autoRefresh) {
      await chrome.tabs.reload(activeTab.id);
      // Ждём загрузки страницы
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          data.monitoring?.refreshDelay || DEFAULT_REFRESH_DELAY
        )
      );
    }

    // Делаем новый скриншот
    const screenshot = await chrome.tabs.captureVisibleTab({
      format: 'png',
    });

    // Сравниваем скриншоты
    const comparison = await compareScreenshots(
      data.reference.screenshot,
      screenshot
    );

    console.log(
      `Comparison result: ${comparison.hasChanged ? 'CHANGED' : 'NO CHANGE'} (${comparison.changePercentage}%)`
    );

    // Обновляем время последней проверки
    const config: MonitoringConfig = {
      ...(data.monitoring || {}),
      isActive: data.monitoring?.isActive || false,
      intervalMin: data.monitoring?.intervalMin || DEFAULT_INTERVAL_MIN,
      intervalMax: data.monitoring?.intervalMax || DEFAULT_INTERVAL_MAX,
      autoRefresh: data.monitoring?.autoRefresh ?? true,
      refreshDelay: data.monitoring?.refreshDelay || DEFAULT_REFRESH_DELAY,
      lastCheckTime: Date.now(),
    };
    await chrome.storage.local.set({ monitoring: config });

    // Если изменения обнаружены
    if (comparison.hasChanged) {
      console.log('⚠️ Changes detected! Sending notifications...');
      await sendTelegramNotification(data.telegram!, comparison);
      await showBrowserNotification(comparison);
    }
  } catch (error) {
    console.error('Check error:', error);
  }
}

// Отправка уведомления в Telegram
async function sendTelegramNotification(
  config: TelegramConfig,
  comparison: ComparisonResult
) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  
  const message = `🎯 SlotWatch Pro Alert!

Detected changes on the monitored page!

Change percentage: ${comparison.changePercentage}%

Slots may be available now! Check immediately.`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
      }),
    });

    if (response.ok) {
      console.log('Telegram notification sent');
    } else {
      console.error('Telegram error:', await response.text());
    }
  } catch (error) {
    console.error('Telegram error:', error);
  }
}

// Браузерное уведомление
async function showBrowserNotification(comparison: ComparisonResult) {
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SlotWatch Pro Alert!',
    message: `Changes detected! ${comparison.changePercentage}% of pixels changed`,
    priority: 2,
  });
  console.log('Browser notification shown');
}

// Случайный интервал для антидетекции
function getRandomInterval(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}