# Device management

FastFood Riza runs on **one Windows PC** in the restaurant. That machine runs the POS,
the local API, PostgreSQL and every hardware integration. There is no kitchen PC, and
everything keeps working on the LAN with the public internet down.

## What the restaurant has

| Device          | Connection              | Purpose                                     |
| --------------- | ----------------------- | ------------------------------------------- |
| Receipt printer | COM / USB / Windows     | Non-fiscal customer receipt                 |
| NFC reader      | COM / USB               | Waiter sign-in, manager override, enrolment |
| Kitchen printer | Ethernet / Wi-Fi, LAN IP | Kitchen ticket after Send to Kitchen        |
| Bar printer     | Ethernet / Wi-Fi, LAN IP | Bar ticket                                  |

Configure them in **Devices** in the admin navigation. Nothing is hardcoded: no COM port
and no IP address appears anywhere in the code or the seed.

## How the pieces fit

```
Browser POS ──► API (container, no outbound network)
     │            stores device config, routing, print jobs, card hashes
     │
     └──► Device Agent on 127.0.0.1  ──► COM / USB / Windows spooler
                                     └─► LAN printers on 192.168.x.x:9100
```

The API container sits on an `internal: true` Docker network and has no outbound access.
That is deliberate, and this feature does not change it: the **Device Agent performs
every physical delivery**, including to LAN printers, and the API only records what
happened.

### Why the browser talks to loopback

The page reaches the agent at a fixed loopback port. Browsers treat `127.0.0.1` as a
trustworthy origin, so an HTTPS page may call it without a mixed-content block; this was
verified against a real HTTPS origin rather than assumed. The page's CSP allows exactly
that one destination and nothing else.

### Device Agent security

- Binds `127.0.0.1` only. It is not reachable from the restaurant LAN, which the agent
  test suite asserts against this machine's real network address.
- Every request carries a shared token, compared in constant time.
- Only the POS origin may call it; any other origin is refused.
- Five commands exist and nothing else: `status`, `discover`, `test`, `print`, `nfc.read`.
  There is no shell, no file path and no arbitrary destination in any request.
- A caller names a **device id**. The agent asks the API for that device's saved address,
  so a browser can never point restaurant hardware somewhere of its choosing.

## Printing

`Send to Kitchen` is unchanged. The existing station routing validation still decides
whether an order may be submitted at all. Printing happens afterwards and is strictly
downstream:

- One print job per kitchen ticket, keyed on the ticket's existing **`documentId`**.
  That id is stable across ticket version bumps but different once a ticket is cancelled,
  so a reprint never duplicates and a cancellation always gets its own document.
- If a printer is offline the submission **stays valid**, the job is visibly `RETRY
  REQUIRED`, and it can be retried. No order, submission, ticket or payment is altered.
- A station with no printer fails visibly, naming the station. Nothing is ever sent to a
  default or fallback printer.
- Several stations may share one printer on purpose; each may also have its own.

## Receipts

A customer receipt is built from the settled order, its frozen line snapshots and the
recorded tenders. Every amount is copied verbatim from what the ledger stores.

**It is not a fiscal receipt.** FastFood Riza does not fiscalize; EnterNet's F-LINK owns
fiscal numbering, signing and receipt format. Every receipt carries a notice saying so.

## Staff cards

- **Enrolment**: Devices → assign a card to a person. Only an argon2id hash is stored, so
  the database never holds a value that could be written onto a blank card. A card already
  assigned to somebody else is refused rather than silently moved.
- **Sign-in**: tapping a card resolves the person server-side. The client never sends a
  user, a role or a permission. Failed taps are audited.
- **Manager override**: card **plus PIN**. A cloned UID alone cannot authorise a sensitive
  action. Both approvals and refusals are audited.

## Starting up

Staff should never touch a terminal. On the restaurant PC:

1. Docker Desktop starts at login (its own setting), bringing up the database, API, admin
   and nginx, all with `restart: unless-stopped`.
2. The Device Agent starts from a Scheduled Task at boot:

```
schtasks /create /tn "FastFood Riza Device Agent" /sc onstart /ru SYSTEM ^
  /tr "node C:\riza\apps\device-agent\dist\main.js"
```

3. The POS opens to the local address in kiosk mode.

Devices reconnect on their own: the agent reopens a printer connection per job rather
than holding one, so a printer switched off and on again simply starts working.

## Hardware information still required

The adapter boundary is complete, but the following is needed before physical printing
and card reading can work. Where a protocol is unknown the adapter **refuses and says
so** rather than pretending to succeed, because a silently discarded kitchen ticket is
worse than a visible failure.

1. **Printer make, model and command set** for the receipt, kitchen and bar printers
   (ESC/POS or otherwise).
2. **Character encoding** for Albanian text (ë, ç), and the codepage the printers use.
3. **Paper width** (58mm or 80mm) and characters per line.
4. Whether the LAN printers accept **raw TCP on 9100**, or need another port or protocol.
5. Whether the Windows-attached printer accepts **raw pass-through** printing.
6. **NFC reader make, model and interface**: keyboard-wedge, serial, or PC/SC.
7. **Card technology and UID length** (MIFARE Classic, DESFire, NTAG…).
8. Whether a cash drawer is attached to the receipt printer and should be pulsed.
