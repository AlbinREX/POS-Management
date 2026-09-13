# KDS

The Phase 5 KDS is served at `/kds` by the existing Next.js frontend, using the same authentication and API deployment. This directory reserves independent application packaging; it is not a separate running service. See `apps/admin/src/components/kitchen-display.tsx` and ADR 0005. Kitchen-only accounts have kitchen.read/manage permissions and no order financial or administrative API access.
