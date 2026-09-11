# Claude Design brief — Beacon

Copy everything below into Claude Design as the starting brief.

---

## What this is

Beacon is an internal Progressive Web App for Tube Products of India. It
gives real-time visibility into every truck at every plant, from gate-in to
gate-out, with photo evidence at key stages, automatic halting-cost
calculation, and role-based access. It replaces a manual, paper-based
process, so the core design job is making a fast-moving factory-floor
workflow feel calm, clear, and trustworthy, not making it look flashy.

It's a PWA: installable on any device, opens full-screen with no browser
chrome once added to the home screen. Design it as an app, not a website.

## Brand

**Logo.** Design a mark for the name "Beacon," built around the idea of a
signal that makes something visible from a distance, in the dark if needed.
Explore a few directions: radiating signal rings (like a radar ping), an
abstracted lighthouse or beam of light, a pulsing point. It needs to work as
a small, flat app icon (legible at 48px) as much as it needs to work as a
full lockup with the wordmark. Tone: confident and clear, not playful,
this sits on a factory manager's phone next to their other work tools, not
a consumer social app.

**Color.** Use this exact scale (Tailwind-style naming: `deep-forest-green`
in code, but note for design purposes the actual hex values are a bright
lime/chartreuse family, not a forest green, design against the real colors
below, not the variable name):

```
50:  #f7ffe6
100: #edfec9
200: #dafd99
300: #c0f95d
400: #a5ee2d
500: #86d40e   <- primary brand color
600: #66aa06
700: #4e810a
800: #3f660e
900: #365611
950: #192e03
```

Suggested usage, adjust if a different balance reads better:
- 500/600 as the primary accent: buttons, active states, key CTAs, the
  logo's main color
- 950/900 for dark text, dark-mode backgrounds, or high-contrast headers
- 50/100 as light backgrounds and tints, not pure white everywhere
- 700/800 for hover/pressed states
- Since this is a single-hue palette, pair it with a neutral gray scale for
  body text and surfaces, don't force every element into this green

**Typography.** Poppins throughout. SemiBold or Bold for headings and
status labels, Regular or Medium for body text and form fields.

## Design constraints that actually matter here

- **Outdoor daylight readability.** Security uses this at a gate PC, often
  outdoors or near an open bay, screens need to hold contrast in bright
  light, not just look good in a studio render.
- **Big tap targets.** Loading Operators are on phones, often with gloves
  or in a hurry, don't design delicate touch targets.
- **Status must be readable at a glance.** The live queue is the single
  most important screen, color and label need to communicate a truck's
  state and whether it's overdue (waiting past 12 hours) without anyone
  reading paragraph text.
- **An incomplete record is a real, common state**, not an edge case, design
  clearly for a vehicle that's been gate-logged but not yet tagged with a
  customer, and vice versa.
- **Offline is expected, not exceptional.** Gate and dock connectivity can
  drop, design a clear, non-alarming indicator for "saved locally, will
  sync" versus a real error.

## Pages to design

**1. Landing / role selector**
First screen anyone sees. Options: Security, Loading Operator, Logistics,
Corporate Admin (each leads to login), and Viewer (leads to a plant
picker, no login).

**2. Login**
Named account login for the four working roles.

**3. Viewer mode**
Plant selection dropdown, then a short access-code entry, then straight
into a read-only version of the live status board below.

**4. Live status board (the core screen)**
Per-plant, real-time list of trucks: status (arrived, loading, unloading,
loaded, unloaded, exited), how long they've been waiting, a clear flag on
anything past 12 hours, running halting cost if applicable. This is the
screen people glance at all day, on a shared plant monitor and on phones.
Design both a compact mobile version and a larger shared-display version.

**5. Security: gate-in (arrival)**
Minimal form: Vehicle No, Driver No, a photo capture of the empty truck
(camera or upload). Arrival time is auto-stamped, not entered, make that
implicit in the design (no time field to fill in).

**6. Security: gate-out (exit)**
Simple confirm-and-log screen to close out a visit.

**7. Loading Operator: status update**
Move a truck through loading/unloading to loaded/unloaded, with a
required photo of the loaded truck at completion.

**8. Logistics: pre-registration**
Enter Customer and Location for a truck, either ahead of arrival or to
complete a record that arrived without one.

**9. Vehicle detail / timeline view**
One truck's full visit: every timestamp, every photo, current halting
cost, shown as a clear chronological trail, this is what someone opens to
resolve a dispute, so it needs to read as evidence, not just a log.

**10. MIS reporting**
Plant-level view (cost by day/week/month, average turnaround, FIFO
compliance) and a corporate rollup comparing all plants. Data-dense but
should surface the one number that matters (cost trend against baseline)
without making the viewer hunt for it.

**11. Corporate Admin panel**
Manage users, plants, and halting-cost rate slabs. Utilitarian, this is
back-office configuration, not a showcase screen.

**12. PWA install and notification prompts**
Small, contextual moments: a prompt to install the app after first login,
and a prompt to enable notifications, explained in one line each, not a
generic browser permission dialog.

## Deliverables

- Logo: a few directions, plus the chosen mark refined for both a
  standalone icon and a full lockup with wordmark
- A small design system: color usage, type scale, spacing, and component
  states (buttons, status badges, cards, form fields, the ageing-flag
  treatment)
- High-fidelity mockups for all pages above. Security and Corporate Admin
  screens can be desktop-first, Loading Operator and Viewer should be
  mobile-first, the live status board needs both a mobile and a
  shared-display version
