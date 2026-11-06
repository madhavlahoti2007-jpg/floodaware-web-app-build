import { ResilienceWorkspace } from '@/components/floodaware/resilience-workspace'

export const dynamic = 'force-dynamic'

export default function Page() {
  return <ResilienceWorkspace initialNow={Date.now()} />
}

