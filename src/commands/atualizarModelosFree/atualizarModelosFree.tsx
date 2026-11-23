import * as React from 'react'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { PROVIDERS, saveOpenRouterConfig } from '../../utils/openclaudeConfig.js'
import {
  ordenarPorCapacidade,
  filtrarGratis,
  fetchProviderModels,
  testarModelo,
} from '../../utils/freeModels.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { OnDone } from '../model/model.js'

const TOP_POR_PROVEDOR = 3
const MELHORES_KEY = 'melhores'

interface MelhorModelo {
  provider: string
  model: string
  label: string
}

function readMelhores(): MelhorModelo[] {
  try {
    const configFile = path.join(getClaudeConfigHomeDir(), 'config.json')
    if (!fs.existsSync(configFile)) return []
    const data = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    const providers = data && typeof data === 'object' ? data.providers : undefined
    const raw = providers && typeof providers === 'object' ? (providers as Record<string, unknown>)[MELHORES_KEY] : undefined
    if (!raw || !Array.isArray(raw)) return []
    return raw
      .filter(
        (item): item is MelhorModelo =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as MelhorModelo).provider === 'string' &&
          typeof (item as MelhorModelo).model === 'string' &&
          typeof (item as MelhorModelo).label === 'string',
      )
      .slice(0, 50)
  } catch {
    return []
  }
}

function salvarMelhores(lista: MelhorModelo[]): void {
  const configFile = path.join(getClaudeConfigHomeDir(), 'config.json')
  let existing: Record<string, unknown> = {}
  if (fs.existsSync(configFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    } catch {}
  }
  const providers =
    existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>) }
      : {}
  providers[MELHORES_KEY] = lista
  saveOpenRouterConfig({ providers })
}

async function fluxoAtualizar(): Promise<{ resumo: string }> {
  const linhas: string[] = []
  const lista: MelhorModelo[] = []

  for (const provider of PROVIDERS) {
    const apiKey = process.env[`HUBERCLAUDE_${provider.id.toUpperCase()}_API_KEY`] ||
      process.env[`${provider.id.toUpperCase()}_API_KEY`]
    if (!apiKey) {
      linhas.push(`${provider.label}: sem chave, pulando`)
      continue
    }

    linhas.push(`${provider.label}: buscando modelos...`)
    let modelos
    try {
      modelos = await fetchProviderModels(provider, apiKey)
    } catch {
      linhas.push(`${provider.label}: falha ao buscar modelos`)
      continue
    }

    const gratis = filtrarGratis(modelos, provider.freeModels)
    if (gratis.length === 0) {
      linhas.push(`${provider.label}: nenhum modelo grátis encontrado`)
      continue
    }

    const ordenados = ordenarPorCapacidade(
      modelos.filter(m => gratis.includes(m.id)),
    )
    const top3 = ordenados.slice(0, TOP_POR_PROVEDOR)

    linhas.push(`${provider.label}: ${top3.join(', ')} (testando...)`)

    for (const model of top3) {
      let ativo = false
      let motivo = ''
      try {
        ativo = await testarModelo(provider, apiKey, model)
      } catch (error) {
        ativo = false
        motivo = error instanceof Error ? error.message : String(error)
      }
      if (ativo) {
        lista.push({ provider: provider.id, model, label: provider.label })
      } else {
        linhas.push(`  ${model}: indisp\u00f3nível (${motivo || 'sem resposta'})`)
      }
    }
  }

  salvarMelhores(lista)

  const provedoresComModelos = new Set(lista.map(i => i.provider)).size
  const resumo = `${lista.length} modelo(s) ativo(s) em ${provedoresComModelos} provedor(es)`

  return { resumo }
}

export const call: LocalJSXCommandCall = async (onDone, _context, _args) => {
  let resultado: { resumo: string }
  try {
    resultado = await fluxoAtualizar()
  } catch (error) {
    onDone(`Falha ao atualizar modelos: ${(error as Error).message}`, {
      display: 'system',
    })
    return null
  }

  onDone(
    `Lista /melhores atualizada: ${resultado.resumo}. Rode /melhores para escolher um.`,
    { display: 'system' },
  )
  return null
}
