import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const supabase = await createSupabaseServerClient()

  if (code && supabase) await supabase.auth.exchangeCodeForSession(code)

  return NextResponse.redirect(new URL('/?tab=settings', requestUrl.origin))
}
