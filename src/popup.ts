import { MessageType, MessageResponse, StorageData, MonitoringConfig } from './types.js';

const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
const statusIndicator = document.getElementById('statusIndicator') as HTMLDivElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const lastCheckDiv = document.getElementById('lastCheck') as HTMLDivElement;
const attemptCountDiv = document.getElementById('attemptCount') as HTMLDivElement;
const hintText = document.getElementById('hintText') as HTMLParagraphElement;
const attemptLogDiv = document.getElementById('attemptLog') as HTMLDivElement;
const clearLogBtn = document.getElementById('clearLogBtn') as HTMLButtonElement;

const botTokenInput = document.getElementById('botToken') as HTMLInputElement;
const chatIdInput = document.getElementById('chatId') as HTMLInputElement;
const intervalMinInput = document.getElementById('intervalMin') as HTMLInputElement;
const intervalMaxInput = document.getElementById('intervalMax') as HTMLInputElement;
const heartbeatEnabledInput = document.getElementById('heartbeatEnabled') as HTMLInputElement;
const heartbeatIntervalInput = document.getElementById('heartbeatInterval') as HTMLSelectElement;
const directModeInput = document.getElementById('directMode') as HTMLInputElement;

let isMonitoring = false;

async function init() {
  await loadSettings();
  await updateStatus();
  attachEventListeners();
}

async function loadSettings() {
  const data = (await chrome.storage.local.get(['telegram', 'monitoring'])) as Partial<StorageData>;

  if (data.telegram) {
    botTokenInput.value = data.telegram.botToken || '';
    chatIdInput.value = data.telegram.chatId || '';
  }

  if (data.monitoring) {
    intervalMinInput.value = String(data.monitoring.intervalMin || 65);
    intervalMaxInput.value = String(data.monitoring.intervalMax || 120);
    heartbeatEnabledInput.checked = !!data.monitoring.heartbeatEnabled;
    heartbeatIntervalInput.value = String(data.monitoring.heartbeatIntervalMinutes || 90);
    directModeInput.checked = data.monitoring.directMode !== false;
    isMonitoring = data.monitoring.isActive;
  }
}

async function updateStatus() {
  const response = await sendMessage(MessageType.GET_STATUS);

  if (response.success && response.data) {
    const status = response.data as MonitoringConfig;
    isMonitoring = status.isActive;

    if (isMonitoring) {
      statusIndicator.classList.add('active');
      statusIndicator.classList.remove('inactive');
      statusText.textContent = 'Бот активен';
      toggleBtn.textContent = '⏹ Остановить';
      toggleBtn.classList.add('stop');
      hintText.style.display = 'none';
    } else {
      statusIndicator.classList.remove('active');
      statusIndicator.classList.add('inactive');
      statusText.textContent = 'Неактивен';
      toggleBtn.textContent = '▶️ Запустить бота';
      toggleBtn.classList.remove('stop');
      hintText.style.display = 'block';
    }

    if (status.lastCheckTime) {
      const date = new Date(status.lastCheckTime);
      lastCheckDiv.textContent = `Последняя проверка: ${date.toLocaleTimeString()}`;
    }

    attemptCountDiv.textContent = `Попыток: ${status.attemptCount || 0}`;

    if (status.attemptLog && status.attemptLog.length > 0) {
      attemptLogDiv.innerHTML = [...status.attemptLog]
        .reverse()
        .map((ts, i) => {
          const date = new Date(ts);
          const num = (status.attemptCount || 0) - i;
          return `<div class="log-item"><span class="log-num">#${num}</span><span class="log-time">${date.toLocaleTimeString()}</span></div>`;
        })
        .join('');
    }
  }
}

function sendMessage(type: MessageType, payload?: unknown): Promise<MessageResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      resolve(response || { success: false, error: 'No response' });
    });
  });
}

function attachEventListeners() {
  toggleBtn.addEventListener('click', handleToggle);
  saveSettingsBtn.addEventListener('click', handleSaveSettings);
  clearLogBtn.addEventListener('click', handleClearLog);
}

async function handleClearLog() {
  const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;
  await chrome.storage.local.set({
    monitoring: { ...(data.monitoring || {}), attemptLog: [], attemptCount: 0 },
  });
  attemptLogDiv.innerHTML = '<div class="log-empty">Попыток ещё не было</div>';
  attemptCountDiv.textContent = 'Попыток: 0';
}

async function handleToggle() {
  toggleBtn.disabled = true;

  const type = isMonitoring ? MessageType.STOP_MONITORING : MessageType.START_MONITORING;
  const response = await sendMessage(type);

  if (response.success) {
    await updateStatus();
  } else {
    alert(`Ошибка: ${response.error}`);
  }

  toggleBtn.disabled = false;
}

async function handleSaveSettings() {
  const botToken = botTokenInput.value.trim();
  const chatId = chatIdInput.value.trim();
  const intervalMin = parseInt(intervalMinInput.value) || 65;
  const intervalMax = parseInt(intervalMaxInput.value) || 120;

  if (!botToken || !chatId) {
    alert('Заполните Bot Token и Chat ID');
    return;
  }

  if (intervalMin < 61 || intervalMax < 61) {
    alert('Минимальный интервал — 61 секунда (ограничение Chrome)');
    return;
  }

  if (intervalMin >= intervalMax) {
    alert('Мин. интервал должен быть меньше макс.');
    return;
  }

  await chrome.storage.local.set({ telegram: { botToken, chatId } });

  const heartbeatEnabled = heartbeatEnabledInput.checked;
  const heartbeatIntervalMinutes = parseInt(heartbeatIntervalInput.value) || 90;
  const directMode = directModeInput.checked;

  const data = (await chrome.storage.local.get('monitoring')) as Partial<StorageData>;
  await chrome.storage.local.set({
    monitoring: {
      ...(data.monitoring || {}),
      intervalMin,
      intervalMax,
      heartbeatEnabled,
      heartbeatIntervalMinutes,
      directMode,
      isActive: data.monitoring?.isActive || false,
    },
  });

  saveSettingsBtn.textContent = 'Сохранено!';
  setTimeout(() => {
    saveSettingsBtn.textContent = 'Сохранить';
  }, 2000);
}

init();
