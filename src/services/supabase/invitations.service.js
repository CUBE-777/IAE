import { supabase } from './client';

const call = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
};

/** إدارة (0051): { settings: {...}|null, invitations: [...] } */
export const getInvitationsAdmin = (activityId) => call('get_activity_invitations', { p_activity_id: activityId });
export const saveInvitationSettings = (activityId, settings) => call('save_invitation_settings', { p_activity_id: activityId, p: settings });
export const addInvitations = (activityId, guests) => call('add_invitations', { p_activity_id: activityId, p_guests: guests });
export const updateInvitation = (id, g) => call('update_invitation', { p_id: id, p_name: g.name, p_title: g.title || '', p_gender: g.gender });
export const setInvitationRevoked = (id, revoked) => call('set_invitation_revoked', { p_id: id, p_revoked: !!revoked });
export const deleteInvitation = (id) => call('delete_invitation', { p_id: id });

/** عامة: تُرجع null إن كان الرابط غير صالح أو ملغى. تزيد عدّاد الفتح. */
export const getInvitation = (token) => call('get_invitation', { p_token: String(token || '') });
export const respondInvitation = (token, rsvp) => call('respond_invitation', { p_token: String(token || ''), p_rsvp: rsvp });
