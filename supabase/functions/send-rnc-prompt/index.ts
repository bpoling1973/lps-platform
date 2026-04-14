// IMPORTANT: After deploying, disable JWT verification in Supabase Dashboard

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://lps.opsolv.co.uk'
const FROM_EMAIL = 'noreply@opsolv.co.uk'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const RNC_LABELS: Record<string, string> = {
  prerequisites_incomplete: 'Prerequisites not complete',
  design_incomplete: 'Design not complete',
  materials_unavailable: 'Materials not available',
  equipment_unavailable: 'Equipment not available',
  labour_unavailable: 'Labour not available',
  subcontractor_not_ready: 'Subcontractor not ready',
  weather: 'Weather',
  client_decision: 'Client decision',
  changed_scope: 'Changed scope',
  other: 'Other',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  }

  try {
    const { taskId, ppcRecordId, projectId } = await req.json()

    const { data: task } = await supabase
      .from('phase_tasks')
      .select('*, project_members(id, invited_email, profiles(full_name, email)), projects(name)')
      .eq('id', taskId)
      .single()

    if (!task) return new Response('Task not found', { status: 404 })

    const ownerEmail = task.project_members?.profiles?.email || task.project_members?.invited_email
    const ownerName = task.project_members?.profiles?.full_name || ownerEmail

    if (!ownerEmail) return new Response('No owner email', { status: 400 })

    const projectName = task.projects?.name || 'your project'
    const ppcLink = `${APP_URL}/project/${projectId}/ppc`

    const rncOptions = Object.entries(RNC_LABELS)
      .map(([_key, label]) => `<li style="margin: 6px 0;">${label}</li>`)
      .join('')

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="background: #d97706; padding: 16px 24px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 18px;">⚠ Task Incomplete — RNC Required</h1>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
          <p>Hi ${ownerName},</p>
          <p>The following task was not completed this week on <strong>${projectName}</strong>:</p>
          <div style="background: #fffbeb; border-left: 4px solid #d97706; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0;">
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #92400e;">${task.title}</p>
            ${task.trade ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">${task.trade}</p>` : ''}
          </div>
          <p>Please log your <strong>Reason for Non-Completion (RNC)</strong> from the list below by clicking the button:</p>
          <ul style="color: #374151; font-size: 14px;">${rncOptions}</ul>
          <a href="${ppcLink}" style="display: inline-block; background: #d97706; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 8px;">
            Log RNC Now →
          </a>
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
          <p style="font-size: 12px; color: #9ca3af;">OpSolv LPS Platform · <a href="https://opsolv.co.uk" style="color: #9ca3af;">opsolv.co.uk</a></p>
        </div>
      </body>
      </html>
    `

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ownerEmail,
        subject: `Action required: RNC for "${task.title}" — ${projectName}`,
        html,
      }),
    })

    if (!res.ok) throw new Error(`Resend error: ${await res.text()}`)

    await supabase.from('notification_log').insert({
      project_id: projectId,
      recipient_email: ownerEmail,
      channel: 'email',
      event_type: 'rnc_prompt',
      status: 'sent',
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('send-rnc-prompt error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
