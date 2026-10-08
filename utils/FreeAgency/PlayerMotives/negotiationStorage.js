
"use strict";

/**
 * Supabase storage for Free Agency negotiations.
 *
 * Requires an existing authenticated Supabase client.
 *
 * Tables will be created separately.
 *
 * This module does not send Discord messages,
 * approve contracts, or write to Google Sheets.
 */

const SESSIONS_TABLE = "fa_negotiation_sessions";
const EVENTS_TABLE = "fa_negotiation_events";

function createNegotiationStorage(supabase) {
  if (!supabase || typeof supabase.from !== "function") {
    throw new Error("A Supabase client is required.");
  }

  async function saveSession({
    leagueId,
    playerId,
    deadline,
    status = "OPEN",
  }) {
    if (!leagueId || !playerId || !deadline) {
      throw new Error(
        "League ID, player ID, and deadline are required."
      );
    }

    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .upsert(
        {
          league_id: String(leagueId),
          player_id: String(playerId),
          deadline,
          status,
        },
        {
          onConflict: "league_id,player_id",
        }
      )
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  async function getSession(leagueId, playerId) {
    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .select("*")
      .eq("league_id", String(leagueId))
      .eq("player_id", String(playerId))
      .maybeSingle();

    if (error) throw error;

    return data;
  }

  async function saveEvent({
    sessionId,
    teamId,
    eventType,
    payload,
  }) {
    if (!sessionId || !teamId || !eventType) {
      throw new Error(
        "Session ID, team ID, and event type are required."
      );
    }

    const { data, error } = await supabase
      .from(EVENTS_TABLE)
      .insert({
        session_id: sessionId,
        team_id: String(teamId),
        event_type: eventType,
        payload: payload || {},
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  async function getTeamHistory(sessionId, teamId) {
    const { data, error } = await supabase
      .from(EVENTS_TABLE)
      .select("*")
      .eq("session_id", sessionId)
      .eq("team_id", String(teamId))
      .order("created_at", { ascending: true });

    if (error) throw error;

    return data || [];
  }

  async function getCommissionerHistory(sessionId) {
    const { data, error } = await supabase
      .from(EVENTS_TABLE)
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return data || [];
  }

  return Object.freeze({
    saveSession,
    getSession,
    saveEvent,
    getTeamHistory,
    getCommissionerHistory,
  });
}

module.exports = {
  createNegotiationStorage,
};
