import {
  MessageType,
  MessageResponse,
  StorageData,
  MonitoringConfig,
} from './types.js';

// DOM элементы
const captureBtn = document.getElementById('captureBtn') as HTMLButtonElement;
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById(
  'saveSettingsBtn'
) as HTMLButtonElement;
const statusIndicator = document.getElementById(
  'statusIndicator'
) as HTMLDivElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const lastCheckDiv = document.getElementById('lastCheck') as HTMLDivElement;

const botTokenInput = document.getElementById('botToken') as HTMLInputElement;
const chatIdInput = document.getElementById('chatId') as HTMLInputElement;
const keywordsTextarea = document.getElementById(
  'keywords'
) as HTMLTextAreaElement;

// Состояние
let isMonitoring = false;
let hasReference = false;

// Инициализация при открытии popup
async function init() {
  await loadSettings();
  await updateStatus();
  attachEventListeners();
}

// Загрузка сохранённых настроек
async function loadSettings() {
  const data = (await chrome.storage.local.get([
    'telegram',
    'monitoring',
    'keywords',
    'reference',
  ])) as Partial<StorageData>;

  if (data.telegram) {
    botTokenInput.value = data.telegram.botToken || '';
    chatIdInput.value = data.telegram.chatId || '';
  }

  if (data.keywords) {
    keywordsTextarea.value = data.keywords.join('\n');
  } else {
    keywordsTextarea.value = 'Мест нет\nNo slots available\nQueue is full';
  }

  if (data.reference) {
    hasReference = true;
    toggleBtn.disabled = false;
  }

  if (data.monitoring) {
    isMonitoring = data.monitoring.isActive;
  }
}
// Обновление статуса мониторинга
async function updateStatus() {
  const response = await sendMessage(MessageType.GET_STATUS);

  if (response.success && response.data) {
    const status = response.data as MonitoringConfig & { lastCheckTime?: number };
    isMonitoring = status.isActive;

    if (isMonitoring) {
      statusIndicator.classList.add('active');
      statusIndicator.classList.remove('inactive');
      statusText.textContent = 'Monitoring Active';
      toggleBtn.textContent = 'Stop Monitoring';
      toggleBtn.classList.add('stop');
    } else {
      statusIndicator.classList.add('inactive');
      statusIndicator.classList.remove('active');
      statusText.textContent = 'Inactive';
      toggleBtn.textContent = 'Start Monitoring';
      toggleBtn.classList.remove('stop');
    }

    if (status.lastCheckTime) {
      const date = new Date(status.lastCheckTime);
      lastCheckDiv.textContent = `Last check: ${date.toLocaleTimeString()}`;
    }
  }
}

// Отправка сообщения в background
async function sendMessage(
  type: MessageType,
  payload?: unknown
): Promise<MessageResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      resolve(response || { success: false, error: 'No response' });
    });
  });
}

// Обработчики событий
function attachEventListeners() {
  captureBtn.addEventListener('click', handleCapture);
  toggleBtn.addEventListener('click', handleToggle);
  saveSettingsBtn.addEventListener('click', handleSaveSettings);
}

// Захват эталона
async function handleCapture() {
  captureBtn.disabled = true;
  captureBtn.textContent = 'Capturing...';

  const response = await sendMessage(MessageType.CAPTURE_REFERENCE);

  if (response.success) {
    hasReference = true;
    toggleBtn.disabled = false;
    captureBtn.textContent = 'Captured!';
    setTimeout(() => {
      captureBtn.textContent = '📸 Capture Reference';
      captureBtn.disabled = false;
    }, 2000);
  } else {
    captureBtn.textContent = 'Failed';
    alert(`Error: ${response.error}`);
    setTimeout(() => {
      captureBtn.textContent = '📸 Capture Reference';
      captureBtn.disabled = false;
    }, 2000);
  }
}

// Старт/стоп мониторинга
async function handleToggle() {
  if (!hasReference) return;

  toggleBtn.disabled = true;

  const type = isMonitoring
    ? MessageType.STOP_MONITORING
    : MessageType.START_MONITORING;
  const response = await sendMessage(type);

  if (response.success) {
    await updateStatus();
  } else {
    alert(`Error: ${response.error}`);
  }

  toggleBtn.disabled = false;
}

// Сохранение настроек
async function handleSaveSettings() {
  const botToken = botTokenInput.value.trim();
  const chatId = chatIdInput.value.trim();
  const keywordsText = keywordsTextarea.value.trim();

  if (!botToken || !chatId) {
    alert('Please fill in both Telegram Bot Token and Chat ID');
    return;
  }

  const keywords = keywordsText
    .split('\n')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keywords.length === 0) {
    alert('Please provide at least one keyword');
    return;
  }

  const payload = {
    telegram: { botToken, chatId },
    keywords,
  };

  const response = await sendMessage(MessageType.SAVE_SETTINGS, payload);

  if (response.success) {
    saveSettingsBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveSettingsBtn.textContent = 'Save Settings';
    }, 2000);
  } else {
    alert(`Error: ${response.error}`);
  }
}

init();