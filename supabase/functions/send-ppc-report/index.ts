// IMPORTANT: After deploying, disable JWT verification in Supabase Dashboard

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://lps.opsolv.co.uk'
const FROM_EMAIL = 'noreply@opsolv.co.uk'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  }

  try {
    const { ppcRecordId, projectId } = await req.json()

    // Fetch PPC record
    const { data: record } = await supabase
      .from('ppc_records')
      .select('*, projects(name)')
      .eq('id', ppcRecordId)
      .single()

    if (!record) return new Response('Record not found', { status: 404 })

    // Fetch report schedule recipients
    const { data: schedule } = await supabase
      .from('report_schedule')
      .select('recipients')
      .eq('project_id', projectId)
      .eq('report_type', 'weekly_ppc')
      .single()

    const recipients: string[] = schedule?.recipients || []
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ message: 'No recipients configured' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const projectName = record.projects?.name || 'Project'
    const ppc = Number(record.ppc_percent)
    const colour = ppc >= 80 ? '#1e3a5f' : ppc >= 60 ? '#d97706' : '#4b5563'
    const label = ppc >= 80 ? 'On Track' : ppc >= 60 ? 'At Risk' : 'Below Target'
    const dashboardLink = `${APP_URL}/project/${projectId}/dashboard`

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="background: #1e3a5f; padding: 16px 24px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 18px;">Weekly PPC Report — ${projectName}</h1>
          <p style="color: #93c5fd; margin: 4px 0 0; font-size: 14px;">
            Week ending ${new Date(record.week_ending).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
          <div style="display: flex; gap: 16px; margin-bottom: 24px;">
            <div style="flex: 1; background: #f8fafc; border-radius: 8px; padding: 16px; text-align: center; border: 2px solid ${colour};">
              <p style="font-size: 40px; font-weight: bold; margin: 0; color: ${colour};">${ppc}%</p>
              <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">PPC This Week</p>
              <p style="margin: 4px 0 0; font-size: 12px; font-weight: bold; color: ${colour};">${label}</p>
            </div>
            <div style="flex: 1; background: #f8fafc; border-radius: 8px; padding: 16px; text-align: center;">
              <p style="font-size: 40px; font-weight: bold; margin: 0; color: #2563eb;">${record.planned_count}</p>
              <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Tasks Committed</p>
            </div>
            <div style="flex: 1; background: #f8fafc; border-radius: 8px; padding: 16px; text-align: center;">
              <p style="font-size: 40px; font-weight: bold; margin: 0; color: #1e3a5f;">${record.complete_count}</p>
              <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Tasks Complete</p>
            </div>
          </div>
          <a href="${dashboardLink}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            View Full Dashboard →
          </a>
          <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
            Download the full PDF report from the Reports section in the platform.
          </p>
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
          <p style="font-size: 12px; color: #9ca3af;">OpSolv LPS Platform · opsolv.co.uk</p>
        </div>
      </body>
      </html>
    `

    // Send to all recipients
    for (const to of recipients) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to,
          subject: `PPC Report: ${ppc}% — ${projectName} — ${new Date(record.week_ending).toLocaleDateString('en-GB')}`,
          html,
        }),
      })
    }

    // Update last_sent_at
    await supabase.from('report_schedule')
      .update({ last_sent_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('report_type', 'weekly_ppc')

    await supabase.from('notification_log').insert({
      project_id: projectId,
      recipient_email: recipients.join(', '),
      channel: 'email',
      event_type: 'ppc_report',
      status: 'sent',
    })

    return new Response(JSON.stringify({ success: true, sent: recipients.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('send-ppc-report error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
