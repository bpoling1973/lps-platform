// IMPORTANT: After deploying this function, go to Supabase Dashboard
// → Edge Functions → send-task-assignment → Settings → disable JWT verification

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
    const { taskId, projectId } = await req.json()

    // Fetch task details
    const { data: task } = await supabase
      .from('phase_tasks')
      .select('*, project_members(id, invited_email, profiles(full_name, email)), projects(name)')
      .eq('id', taskId)
      .single()

    if (!task) return new Response('Task not found', { status: 404 })

    const ownerEmail = task.project_members?.profiles?.email || task.project_members?.invited_email
    const ownerName = task.project_members?.profiles?.full_name || ownerEmail

    if (!ownerEmail) return new Response('No owner email', { status: 400 })

    const taskLink = `${APP_URL}/project/${projectId}/wwp`
    const projectName = task.projects?.name || 'your project'

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="background: #1e3a5f; padding: 16px 24px; border-radius: 8px 8px 0 0; margin-bottom: 0;">
          <h1 style="color: white; margin: 0; font-size: 18px;">OpSolv LPS Platform</h1>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
          <p>Hi ${ownerName},</p>
          <p>A task has been assigned to you on <strong>${projectName}</strong>:</p>
          <div style="background: #f8fafc; border-left: 4px solid #1e3a5f; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0;">
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #1e3a5f;">${task.title}</p>
            ${task.trade ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">${task.trade}</p>` : ''}
            ${task.planned_start ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">Start: ${new Date(task.planned_start).toLocaleDateString('en-GB')}</p>` : ''}
            ${task.planned_end ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">Finish: ${new Date(task.planned_end).toLocaleDateString('en-GB')}</p>` : ''}
          </div>
          <a href="${taskLink}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 8px;">
            View Weekly Work Plan →
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
        subject: `Task assigned: ${task.title} — ${projectName}`,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Resend error: ${err}`)
    }

    // Log notification
    await supabase.from('notification_log').insert({
      project_id: projectId,
      recipient_email: ownerEmail,
      channel: 'email',
      event_type: 'task_assignment',
      status: 'sent',
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('send-task-assignment error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
