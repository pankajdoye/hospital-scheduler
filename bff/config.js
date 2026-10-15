/**
 * Team D BFF configuration.
 * Override any value with an environment variable of the same name.
 */
module.exports = {
  TEAM_A_URL: process.env.TEAM_A_URL || "http://localhost:3001",
  TEAM_B_URL: process.env.TEAM_B_URL || "http://localhost:3000",
  TEAM_C_URL: process.env.TEAM_C_URL || "http://localhost:8080",
  TEAM_C_TOKEN: process.env.TEAM_C_TOKEN || "teamc-admin-demo",
  DOWNSTREAM_TIMEOUT_MS: 8000,

  /**
   * Canonical provider identity mapping across the three backends.
   * - bff:   UUID used by the frontend and Team B (matches Team B seed data)
   * - teamC: integer doctor_id in Team C's MySQL `doctors` table
   * - teamA: string provider id in Team A's in-memory slots (null = not configured)
   */
  PROVIDER_MAP: [
    { bff: "11111111-1111-1111-1111-111111111111", teamC: 1, teamA: "PROV001" }, // Dr. Asha Patil
    { bff: "22222222-2222-2222-2222-222222222222", teamC: 2, teamA: "PROV002" }, // Dr. Rahul Sharma
    { bff: "33333333-3333-3333-3333-333333333333", teamC: 3, teamA: "PROV003" }, // Dr. Priya Deshmukh
  ],
};
