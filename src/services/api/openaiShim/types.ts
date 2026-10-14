export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface AnthropicStreamEvent {
  type: string
  message?: Record<string, unknown>
  index?: number
  content_block?: Record<string, unknown>
  delta?: Record<string, unknown>
  usage?: Partial<AnthropicUsage>
}

export interface ShimCreateParams {
  model: string
  messages: Array<Record<string, unknown>>
  system?: unknown
  tools?: Array<Record<string, unknown>>
  max_tokens: number
  stream?: boolean
  temperature?: number
  top_p?: number
  tool_choice?: unknown
  metadata?: unknown
  [key: string]: unknown
}
