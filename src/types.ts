// Настройки ТГ
export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

// Дефолтный снимок страницы
export interface ReferenceSnapshot {
  url: string;
  timestamp: number;
  screenshot: string; 
  recognizedText: string;
  keyPhrases: string[]; 
}

// Настройки мониторинга
export interface MonitoringConfig {
  isActive: boolean;
  intervalMin: number; 
  intervalMax: number; 
  autoRefresh: boolean; 
  refreshDelay: number; 
  lastCheckTime?: number;
}

// Хранилище данных расширения
export interface StorageData {
  telegram?: TelegramConfig;
  reference?: ReferenceSnapshot;
  monitoring: MonitoringConfig;
  keywords: string[]; 
}

// Сообщения между popup и background
export enum MessageType {
  CAPTURE_REFERENCE = 'CAPTURE_REFERENCE',
  START_MONITORING = 'START_MONITORING',
  STOP_MONITORING = 'STOP_MONITORING',
  GET_STATUS = 'GET_STATUS',
  SAVE_SETTINGS = 'SAVE_SETTINGS',
}

export interface Message {
  type: MessageType;
  payload?: unknown;
}

// Ответ от background script
export interface MessageResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Результат OCR распознавания
export interface OCRResult {
  text: string;
  confidence: number;
}

// Результат сравнения
export interface ComparisonResult {
  hasChanged: boolean;
  missingPhrases: string[]; 
  detectedText: string;
}