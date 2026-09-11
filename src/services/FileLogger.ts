/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FileLogger — registro en memoria con timestamp para depuración del flujo
 * de eventos y fases. Singleton global, descarga como archivo de texto.
 */

export interface LogEntry {
  timestamp: string;
  message: string;
  data?: unknown;
}

class FileLogger {
  private logs: string[] = [];
  private entries: LogEntry[] = [];
  private maxEntries = 5000;

  private formatTimestamp(): string {
    const now = new Date();
    // ISO con ms para ordenar y debug preciso, ej. 2026-05-13T14:22:10.123Z
    return now.toISOString();
  }

  private formatData(data?: unknown): string {
    if (data === undefined || data === null) return "";
    try {
      if (typeof data === "string") return ` | ${data}`;
      return ` | ${JSON.stringify(data)}`;
    } catch {
      return ` | ${String(data)}`;
    }
  }

  log(message: string, data?: unknown): void {
    const timestamp = this.formatTimestamp();
    const line = `[${timestamp}] ${message}${this.formatData(data)}`;
    this.logs.push(line);
    this.entries.push({ timestamp, message, data });
    if (this.logs.length > this.maxEntries) {
      this.logs.shift();
      this.entries.shift();
    }
    // Mantener también en consola para desarrollo
    console.log(line);
  }

  info(message: string, data?: unknown): void {
    this.log(`INFO: ${message}`, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(`WARN: ${message}`, data);
  }

  error(message: string, data?: unknown): void {
    this.log(`ERROR: ${message}`, data);
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.logs = [];
    this.entries = [];
  }

  toText(): string {
    return this.logs.join("\n");
  }

  download(filename = `announs_logs_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`): void {
    const text = this.toText() || "Sin logs registrados";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  size(): number {
    return this.logs.length;
  }
}

// Singleton global
export const fileLogger = new FileLogger();
export default fileLogger;
