import { useEffect, useState } from 'react'
import { useAppState } from '../state/AppState.js'
import { fetchOpenRouterUsage } from '../commands/usage/openRouterUsage.js'
import type { OpenRouterUsageSnapshot } from '../commands/usage/openRouterUsage.js'

export function useUsagePoller() {
  const [usage, setUsage] = useState<OpenRouterUsageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const model = useAppState(s => s.mainLoopModel)

  useEffect(() => {
    let isMounted = true

    const fetchUsage = async () => {
      try {
        // Only fetch for OpenRouter models
        if (model && model.includes('openrouter')) {
          const usageData = await fetchOpenRouterUsage()
          if (isMounted) {
            setUsage(usageData)
            setError(null)
          }
        } else {
          if (isMounted) {
            // For non-OpenRouter models, provide a default usage object
            setUsage({
              credits: null,
              key: {
                label: null,
                usage: 0,
                usageDaily: null,
                usageWeekly: null,
                usageMonthly: null,
                limit: null,
                limitRemaining: null,
                isFreeTier: true
              }
            })
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch usage data')
          setUsage(null)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    // Fetch immediately
    fetchUsage()

    // Poll every 30 seconds
    const interval = setInterval(fetchUsage, 30000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [model])

  return { usage, loading, error }
}