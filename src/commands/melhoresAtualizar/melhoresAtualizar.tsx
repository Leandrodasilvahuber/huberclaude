import * as React from 'react'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { atualizarMelhores } from '../../utils/freeModels.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { OnDone } from '../model/model.js'

function Atualizando({ onDone }: { onDone: OnDone }): React.ReactNode {
  React.useEffect(() => {
    atualizarMelhores()
      .then(({ linhas, lista }) => {
        const provedores = new Set(lista.map(item => item.provider)).size
        onDone(
          [
            ...linhas,
            `Lista /melhores atualizada: ${lista.length} modelo(s) ativo(s) em ${provedores} provedor(es).${lista.length ? ' Rode /melhores para escolher um.' : ''}`,
          ].join('\n'),
          { display: 'system' },
        )
      })
      .catch((error: unknown) => {
        onDone(`Falha ao atualizar modelos: ${(error as Error).message}`, {
          display: 'system',
        })
      })
    // Roda uma vez ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <LoadingState message="Buscando e testando modelos grátis nos provedores…" />
}

export const call: LocalJSXCommandCall = async onDone => (
  <Atualizando onDone={onDone} />
)
