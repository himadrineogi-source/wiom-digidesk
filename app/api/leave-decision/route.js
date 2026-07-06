import { updateDataKey } from '../../../lib/data-store.js';
import { requireDigideskUser } from '../../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export async function POST(request) {
  const auth = await requireDigideskUser();
  if (auth.response) return auth.response;

  const { leaveId, decision, reason } = await request.json();
  const appUser = auth.context.appUser;
  const approverName = appUser.mgrName || auth.context.employee.name;
  const normalizedDecision = String(decision || '').toLowerCase();

  if (!leaveId || !['approve', 'reject'].includes(normalizedDecision)) {
    return Response.json(
      { ok: false, error: 'A valid leave decision is required.' },
      { status: 400 }
    );
  }

  if (!['manager', 'hr'].includes(appUser.role)) {
    return Response.json(
      { ok: false, error: 'Manager or HR access is required.' },
      { status: 403 }
    );
  }

  if (normalizedDecision === 'reject' && !String(reason || '').trim()) {
    return Response.json(
      { ok: false, error: 'A rejection reason is required.' },
      { status: 400 }
    );
  }

  let updatedLeave = null;
  let notFound = false;
  let forbidden = false;

  const { saved } = await updateDataKey('wiom_leaves', [], leaves => {
    const index = leaves.findIndex(leave => leave.id === leaveId);
    if (index === -1) {
      notFound = true;
      return leaves;
    }

    const leave = leaves[index];
    if (appUser.role === 'manager' && leave.mgr !== approverName) {
      forbidden = true;
      return leaves;
    }

    if (normalizedDecision === 'approve') {
      leave.status = 'Approved';
      leave.approvedBy = approverName;
      leave.approvedOn = today();
      leave.approvedAt = new Date().toISOString();
      leave.rejectReason = '';
      delete leave.rejectedBy;
      delete leave.rejectedOn;
      delete leave.rejectedAt;
    } else {
      leave.status = 'Rejected';
      leave.rejectReason = String(reason || '').trim();
      leave.rejectedBy = approverName;
      leave.rejectedOn = today();
      leave.rejectedAt = new Date().toISOString();
    }

    updatedLeave = { ...leave };
    return leaves;
  });

  if (notFound) {
    return Response.json({ ok: false, error: 'Leave request was not found.' }, { status: 404 });
  }

  if (forbidden) {
    return Response.json(
      { ok: false, error: 'You can only decide leave requests for your own team.' },
      { status: 403 }
    );
  }

  if (!saved || !updatedLeave) {
    return Response.json({ ok: false, error: 'Leave decision was not saved.' }, { status: 500 });
  }

  const message = normalizedDecision === 'approve'
    ? `Your ${updatedLeave.type} leave (${formatDate(updatedLeave.from)} - ${formatDate(updatedLeave.to)}) has been approved by ${approverName}.`
    : `Your ${updatedLeave.type} leave (${formatDate(updatedLeave.from)} - ${formatDate(updatedLeave.to)}) was rejected by ${approverName}. Reason: ${updatedLeave.rejectReason}`;

  try {
    await updateDataKey('wiom_notifs', {}, notifications => {
      if (!updatedLeave.empId) return notifications;
      if (!notifications[updatedLeave.empId]) notifications[updatedLeave.empId] = [];
      notifications[updatedLeave.empId].unshift({ msg: message, date: today(), read: false });
      return notifications;
    });
  } catch (error) {
    console.error('Leave decision notification failed:', error?.message);
  }

  return Response.json({ ok: true, leave: updatedLeave });
}
