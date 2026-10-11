import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface OpenRouterConfig {
  apiKey?: string
  baseUrl?: string
}

const CONFIG_DIR = path.join(os.homedir(), '.openclaude')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export function getOpenRouterConfig(): OpenRouterConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
      const data = JSON.parse(content)
      return {
        apiKey: data.apiKey,
        baseUrl: data.baseUrl,
      }
    }
  } catch {
    // Retorna vazio caso ocorra erro de leitura ou parse
  }
  return {}
}

export function saveOpenRouterConfig(config: OpenRouterConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }

    let existing: Record<string, any> = {}
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
      } catch {}
    }

    const updated = {
      ...existing,
      ...config,
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save OpenRouter config:', err)
  }
}