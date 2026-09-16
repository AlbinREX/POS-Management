# Owner dashboard

Reserved app boundary. Phase 11 delivers the owner dashboard as the **Dashboard** tab of `apps/admin`, over the read-only `/api/reports` routes behind `report.read`, so it shares sign-in, session refresh, the `/api` proxy, CSP and the Docker/Nginx topology with the rest of the frontend. A separately packaged dashboard application remains a later decision; see [ADR 0011](../../docs/adr/0011-reporting-owner-dashboard.md).
