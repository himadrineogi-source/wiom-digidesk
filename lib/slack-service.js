import crypto from 'node:crypto';
import { readData, updateDataKey } from './data-store.js';

function getManagerIds() {
  try {
    return JSON.parse(process.env.SLACK_MGR_IDS || '{"Pramod":"U099S3YG6SW","Devashish Mukherjee":"U07GW5ML467"}');
  } catch {
    return {};
  }
}

async function slackApi(endpoint, payload) {
  if (!process.env.SLACK_TOKEN) return {};

  try {
    const response = await fetch(`https://slack.com/api/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return await response.json();
  } catch (error) {
    console.error('Slack error:', error?.message);
    return {};
  }
}

function slackDm(userId, text, blocks) {
  const payload = { channel: userId, text };
  if (blocks) payload.blocks = blocks;
  return slackApi('chat.postMessage', payload);
}

function slackUpdate(channel, ts, text, blocks) {
  const payload = { channel, ts, text, blocks: blocks || [] };
  return slackApi('chat.update', payload);
}

function leaveBlocks(empName, empId, leaveType, from, to, days, reason, leaveId) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:beach_with_umbrella: *New Leave Request*\n*Employee:* ${empName} (${empId})\n*Type:* ${leaveType}\n*Dates:* ${from} to ${to} (${days} day${days > 1 ? 's' : ''})\n*Reason:* ${reason || '-'}`
      }
    },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: ':white_check_mark: Approve' }, style: 'primary', action_id: 'approve_leave', value: leaveId },
        { type: 'button', text: { type: 'plain_text', text: ':x: Reject' }, style: 'danger', action_id: 'reject_leave', value: leaveId }
      ]
    }
  ];
}

export async function notifyLeave(body) {
  if (!process.env.SLACK_TOKEN) return { ok: true };

  const { empName, empId, manager, leaveType, from, to, days, reason, leaveId } = body;
  const slackId = getManagerIds()[manager];
  if (slackId) {
    await slackDm(
      slackId,
      `:beach_with_umbrella: New leave request from ${empName}`,
      leaveBlocks(empName, empId, leaveType, from, to, days, reason, leaveId)
    );
  }

  return { ok: true };
}

function verifySlackSignature(rawBody, headers) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true;

  const timestamp = headers.get('x-slack-request-timestamp');
  const signature = headers.get('x-slack-signature');
  if (!timestamp || !signature) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  return expected.length === signature.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function handleSlackAction(rawBody, headers) {
  if (!verifySlackSignature(rawBody, headers)) {
    return { status: 401, body: 'Unauthorized' };
  }

  const payloadValue = new URLSearchParams(rawBody).get('payload');
  const payload = payloadValue ? JSON.parse(payloadValue) : {};
  const action = payload.actions && payload.actions[0];
  if (!action) return { status: 200, body: '' };

  const leaveId = action.value;
  const approved = action.action_id === 'approve_leave';
  const managerIds = getManagerIds();
  const managerSlackId = payload.user?.id;
  const managerName = Object.keys(managerIds).find(name => managerIds[name] === managerSlackId) || 'Manager';
  const channel = payload.channel?.id;
  const messageTs = payload.message?.ts;
  let leave = null;

  await updateDataKey('wiom_leaves', [], leaves => {
    const leaveIndex = leaves.findIndex(item => item.id === leaveId);
    if (leaveIndex === -1) return leaves;

    leave = leaves[leaveIndex];
    leave.status = approved ? 'Approved' : 'Rejected';
    leave.approvedBy = managerName;
    leave.approvedAt = new Date().toISOString();
    return leaves;
  });

  if (!leave) {
    if (channel) {
      await slackApi('chat.postMessage', {
        channel,
        text: ':warning: Leave request not found. It may have already been processed.'
      });
    }
    return { status: 200, body: '' };
  }

  const decisionText = approved
    ? `:white_check_mark: *Approved* by ${managerName}\n*Employee:* ${leave.empName} (${leave.empId}) | *Type:* ${leave.type} | *Dates:* ${leave.from} to ${leave.to}`
    : `:x: *Rejected* by ${managerName}\n*Employee:* ${leave.empName} (${leave.empId}) | *Type:* ${leave.type} | *Dates:* ${leave.from} to ${leave.to}`;

  if (channel && messageTs) {
    await slackUpdate(channel, messageTs, decisionText, [
      { type: 'section', text: { type: 'mrkdwn', text: decisionText } }
    ]);
  }

  const employeeSlackId = managerIds[leave.empName];
  if (employeeSlackId) {
    await slackDm(employeeSlackId, approved
      ? `:white_check_mark: *Leave Approved!*\nYour ${leave.type} from ${leave.from} to ${leave.to} has been approved by ${managerName}.`
      : `:x: *Leave Rejected*\nYour ${leave.type} from ${leave.from} to ${leave.to} has been rejected by ${managerName}.`
    );
  }

  return { status: 200, body: '' };
}

export async function sendDailyAttendance() {
  if (!process.env.SLACK_TOKEN) return { ok: true, skipped: 'missing Slack token' };

  const data = await readData();
  const att = data.wiom_att ? JSON.parse(data.wiom_att) : {};
  const employees = data.wiom_custom_emps ? JSON.parse(data.wiom_custom_emps) : [];
  const todayText = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayKey = new Date().toISOString().split('T')[0];
  const managerIds = getManagerIds();
  const byManager = {};

  employees.forEach(employee => {
    if (!employee.mgr) return;
    if (!byManager[employee.mgr]) byManager[employee.mgr] = [];
    byManager[employee.mgr].push(employee);
  });

  for (const [managerName, team] of Object.entries(byManager)) {
    const slackId = managerIds[managerName];
    if (!slackId) continue;

    const present = [];
    const absent = [];
    team.forEach(employee => {
      const record = att[`${employee.id}__${todayKey}`] || att[`${employee.id}_${todayKey}`];
      if (record && record.in) present.push(`:white_check_mark: ${employee.name} - In: ${record.in}`);
      else absent.push(`:x: ${employee.name} - Not Marked`);
    });

    const message = `:clipboard: *Daily Attendance Report - ${todayText}*\n*Team: ${managerName} (${team.length} employees)*\n\n${[...present, ...absent].join('\n')}\n\n*Present: ${present.length} | Absent: ${absent.length}*`;
    await slackDm(slackId, message);
  }

  const pramodId = managerIds.Pramod;
  if (pramodId && employees.length > 0) {
    const lines = [];
    let totalPresent = 0;
    let totalAbsent = 0;

    for (const [managerName, team] of Object.entries(byManager)) {
      lines.push(`\n*Manager: ${managerName}*`);
      team.forEach(employee => {
        const record = att[`${employee.id}__${todayKey}`] || att[`${employee.id}_${todayKey}`];
        if (record && record.in) {
          lines.push(`:white_check_mark: ${employee.name} - In: ${record.in}`);
          totalPresent++;
        } else {
          lines.push(`:x: ${employee.name} - Not Marked`);
          totalAbsent++;
        }
      });
    }

    const message = `:bar_chart: *All-Teams Attendance - ${todayText}*\n${lines.join('\n')}\n\n*Total: ${employees.length} | Present: ${totalPresent} | Absent: ${totalAbsent}*`;
    await slackDm(pramodId, message);
  }

  return { ok: true, employeeCount: employees.length, managerCount: Object.keys(byManager).length };
}
