'use strict';

const crypto = require('crypto');
const { UnauthorizedError, ForbiddenError } = require('./errors');

const ALL_ROLES = ['super_admin', 'editor', 'reviewer', 'publisher'];

function splitEnvList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function canonicalAction(event = {}) {
  const action = String(event.action || '').trim();
  if (action === 'draft') return `draft.${String(event.draft_action || '').trim()}`;
  if (action === 'import_task') return `import_task.${String(event.import_task_action || '').trim()}`;
  return action;
}

function allowedRolesForAction(action) {
  if (!action) return ['super_admin'];

  const exact = {
    dashboard: ALL_ROLES,
    list_questions: ALL_ROLES,
    export_questions: ALL_ROLES,
    list_essay_papers: ALL_ROLES,
    get_essay_paper: ALL_ROLES,
    preview_xingce_package: ['super_admin', 'editor', 'reviewer', 'publisher'],
    preview_essay_package: ['super_admin', 'editor', 'reviewer', 'publisher'],
    import_xingce_package: ['super_admin', 'publisher'],
    import_essay_package: ['super_admin', 'publisher'],
    clear_questions: ['super_admin'],
    list_users: ['super_admin'],
  };
  if (exact[action]) return exact[action];

  if (/^(upsert_question|delete_question|batch_import_questions|repair_data_materials)$/.test(action)) {
    return ['super_admin', 'editor'];
  }
  if (/^(list_book_packs|get_book_upload_url)$/.test(action)) return ['super_admin', 'editor', 'reviewer'];
  if (/^(upsert_book_pack|delete_book_pack|upload_book_file|upload_book_file_chunk)$/.test(action)) {
    return ['super_admin', 'editor'];
  }
  if (/^set_essay_paper_status$/.test(action)) return ['super_admin', 'publisher'];

  if (/^draft\.(list|get|stats)$/.test(action)) return ALL_ROLES;
  if (/^draft\.preview_publish$/.test(action)) return ALL_ROLES;
  if (/^draft\.(approve|reject|ai_review)$/.test(action)) return ['super_admin', 'reviewer'];
  if (/^draft\.publish$/.test(action)) return ['super_admin', 'publisher'];
  if (/^draft\.(create|append|update|delete|replace_questions)$/.test(action)) return ['super_admin', 'editor'];

  if (/^import_task\.(list|get|logs)$/.test(action)) return ALL_ROLES;
  if (/^import_task\.(create|cancel|retry|log|recover|resplit)$/.test(action)) return ['super_admin', 'editor'];

  if (/^draft_paper\.(list|get|validate)$/.test(action)) return ALL_ROLES;
  if (/^question_draft\.(list|get)$/.test(action)) return ALL_ROLES;
  if (/^question_draft\.(approve|reject|bulk_approve)$/.test(action)) return ['super_admin', 'reviewer'];
  if (/^question_draft\.(update|recheck)$/.test(action)) return ['super_admin', 'editor', 'reviewer'];
  if (/^ai_review\./.test(action)) return ['super_admin', 'editor', 'reviewer'];
  if (/^release\./.test(action)) return ['super_admin', 'publisher'];
  if (/^file\.get_temp_url$/.test(action)) return ALL_ROLES;

  return ['super_admin'];
}

function hasAllowedRole(identity, allowedRoles) {
  const roles = Array.isArray(identity && identity.roles) ? identity.roles : [];
  return roles.includes('super_admin') || allowedRoles.some(role => roles.includes(role));
}

function createAuth({ cloud, db }) {
  async function authenticateAdmin(event = {}) {
    const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
    const openid = wxContext && wxContext.OPENID ? String(wxContext.OPENID) : '';
    const envAdmins = splitEnvList(process.env.ADMIN_OPENIDS);

    if (openid && envAdmins.includes(openid)) {
      return { openid, roles: ['super_admin'], mode: 'bootstrap_openid' };
    }

    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && event.admin_secret && safeEqual(event.admin_secret, adminSecret)) {
      return { openid, roles: ['super_admin'], mode: 'legacy_secret' };
    }

    if (openid) {
      try {
        const result = await db.collection('admin_users').doc(openid).get();
        const user = result && result.data;
        if (user && user.status !== 'disabled') {
          const roles = (Array.isArray(user.roles) ? user.roles : []).filter(role => ALL_ROLES.includes(role));
          if (roles.length) return { openid, roles, mode: 'admin_users' };
        }
      } catch (error) {
        // 集合尚未创建或用户不存在时，继续按未授权处理。
      }
    }

    throw new UnauthorizedError();
  }

  function authorize(identity, event) {
    const action = canonicalAction(event);
    const allowedRoles = allowedRolesForAction(action);
    if (!hasAllowedRole(identity, allowedRoles)) throw new ForbiddenError();
    return action;
  }

  return { authenticateAdmin, authorize };
}

module.exports = {
  createAuth,
  canonicalAction,
  allowedRolesForAction,
  hasAllowedRole,
  safeEqual,
};
