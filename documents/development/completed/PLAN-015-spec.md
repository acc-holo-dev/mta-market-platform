# MTA Market — PLAN-015 Execution Prompt

## Role

You are implementing **PLAN-015 — MTA Market Experience Architecture & Visual System**.

Repository:

```text
acc-holo-dev/mta-market-platform
```

Current project is already in a technically mature state. Do NOT assume the repository is empty, broken, or needs a rewrite.

Your task is to transform the existing frontend into a coherent, mature, desktop-first MTA Market experience while preserving working backend/domain functionality.

---

# 0. NON-NEGOTIABLE RULE

Do not start by changing code.

First:

```text
INSPECT
→ MAP
→ VERIFY
→ REUSE
→ DESIGN
→ IMPLEMENT
→ TEST
→ DOCUMENT
```

Do not rewrite working domains simply because the UI is changing.

Do not create duplicate backend systems to support visual changes.

Do not invent fake product data when an existing API/domain can provide the real data.

Do not mark anything complete without evidence.

---

# 1. Read the Product Context First

Before implementation, inspect:

```text
documents/
```

and especially the canonical product/design documents currently present in the repository.

Understand these concepts before touching UI:

* marketplace;
* resources;
* free resources;
* services;
* servers;
* community;
* news;
* creators;
* reviews;
* notifications;
* purchases;
* licenses;
* balance;
* compatibility;
* resource health;
* versioning;
* discounts;
* disputes;
* seller ecosystem;
* future Live Demo;
* future 3D Studio;
* future Leak Radar;
* future advanced analytics.

The UI must be designed so future functionality has a logical place without appearing prematurely in the primary navigation.

---

# 2. Inspect Current Frontend

Perform a complete frontend inventory.

Identify:

* application shell;
* layouts;
* navigation;
* sidebar;
* topbar;
* profile/account controls;
* balance UI;
* Home;
* Market;
* Resource pages;
* Server pages;
* Community;
* News;
* Search;
* Dashboard;
* Notifications;
* Admin;
* creator/seller surfaces;
* shared components;
* design tokens;
* global CSS;
* Tailwind configuration;
* typography;
* existing icon system;
* loading/error/empty states;
* responsive behavior.

Create an implementation map before modifying files.

Document:

```text
EXISTING COMPONENT
CURRENT ROLE
REUSE?
MODIFY?
REPLACE?
DELETE?
```

Do not duplicate existing components when a shared abstraction can be improved.

---

# 3. Core Product Direction

The new interface must communicate:

> MTA Market is more than a resource marketplace. It is a unified MTA:SA ecosystem.

The visual/product structure is:

```text
DISCOVER
↓
ENTITY
↓
TRUST
↓
ACTION
```

Users should be able to discover:

* resources;
* servers;
* creators;
* discussions;
* news;
* services.

They then inspect the entity, understand its trust signals, and act.

---

# 4. Desktop-First Requirement

Primary target:

```text
1440×900
1680×1050
1920×1080
2560×1440
```

Do NOT design this as a tablet interface stretched onto desktop.

Requirements:

* compact vertical rhythm;
* controlled content width;
* dense but readable cards;
* small gaps;
* no giant empty regions;
* multiple cards visible simultaneously;
* efficient use of horizontal space.

The interface should feel like a professional desktop product.

---

# 5. Global Shell

Implement a unified shell:

```text
┌────────────────────────────────────────────────────────────┐
│ TOPBAR                                                     │
├──────────────┬─────────────────────────────────────────────┤
│              │                                             │
│   SIDEBAR    │                    CONTENT                  │
│              │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

All major authenticated and public surfaces should share a consistent shell where appropriate.

---

# 6. Sidebar

Implement two states.

## Expanded

Primary:

```text
Home
Market
Servers
Community
News
```

Secondary:

```text
Favorites
Following
Notifications
```

Creator context:

```text
My Resources
My Services
Sales
Analytics
```

Premium:

```text
Premium
```

Bottom:

```text
Collapse
```

## Collapsed

Show icons only.

Requirements:

* no auto-expansion on hover;
* tooltip on icon hover;
* persistent state;
* compact width;
* no unnecessary visual duplication;
* creator section appears only where relevant;
* admin navigation is separate from consumer navigation.

---

# 7. Topbar

The topbar must become a productive control bar.

Concept:

```text
MTA MARKET
[ Global Search ]
[ Context Action ]
[ Live ]
[ Utility ]
[ Theme ]
[ Profile + Balance ]
```

Potential structure:

```text
MTA MARKET
Search...
+ Create
● 1,284 live
Favorites
Notifications
Theme
Holo   $243.60
```

Do not fill the topbar with unnecessary icons just to remove whitespace.

Every element must have a purpose.

---

# 8. Global Search

Search must be ecosystem-wide.

Supported conceptual types:

```text
Resources
Servers
Services
Creators
Discussions
News
```

Search UX should support:

* focused search;
* type-aware results;
* grouped preview results;
* keyboard navigation;
* empty state;
* loading state;
* error state.

Do not create a fake local search implementation if existing search API/domain can be reused.

---

# 9. Context-Aware Create Action

Implement one primary create action.

Its label/action may change based on context:

Home:

```text
+ Create
```

Market:

```text
+ Sell Resource
```

Servers:

```text
+ Add Server
```

Community:

```text
+ New Discussion
```

Creator:

```text
+ Publish
```

Do not place five separate create buttons in the global shell.

---

# 10. Theme System

Implement two first-class themes:

```text
LIGHT
DARK
```

Theme switcher:

* exactly one global toggle;
* no duplicate theme controls;
* persistent user preference;
* system fallback where appropriate.

Light theme:

* neutral background;
* white surfaces;
* restrained border system;
* dark readable typography;
* single controlled accent.

Dark theme:

* deep graphite/near-black base;
* elevated surfaces;
* subtle borders;
* same accent;
* high readability.

Do not implement dark mode as a simple color inversion.

---

# 11. Visual Language

Target character:

```text
Premium technology
+
MTA community
+
Mature desktop product
```

Avoid:

* excessive neon;
* emoji-based UI;
* childish visual language;
* oversized rounded cards;
* excessive glassmorphism;
* decorative clutter;
* giant empty sections;
* generic gaming dashboard aesthetics.

Use:

* restrained motion;
* compact cards;
* strong typography;
* subtle depth;
* meaningful status indicators;
* coherent iconography.

---

# 12. Home

Home is the main Discover surface.

It must NOT be just a marketplace landing page.

Primary sequence:

```text
Sponsored / Featured
↓
Live MTA
↓
Popular Now
↓
New Resources
↓
News + Discussions
↓
Activity
```

Right rail:

```text
Top Creators
Activity
Secondary Sponsored Placement
```

The first viewport should communicate:

> What is happening in MTA right now?

and then:

> What can I discover here?

---

# 13. Sponsored Hero

Implement a reusable promotional/featured component.

Concept:

```text
SPONSORED

MTA NEXT GENERATION

New server...
1,247 online

[ Open ]
```

The component must support different content types:

```text
Sponsored Server
Featured Resource
Platform News
Community Event
Premium Campaign
```

Support:

* carousel/rotation;
* priority;
* active date range;
* campaign state;
* CTA;
* sponsored indicator.

The UI must be compatible with future monetization levels:

```text
Standard
Featured
Premium
Pinned
```

Do not hardcode one advertising implementation into Home.

Create reusable placement architecture.

---

# 14. Live MTA

Add compact live ecosystem strip.

Example:

```text
LIVE MTA

● 1,284 players
37 servers
+12% / 24h
```

Use actual platform data where available.

Never manufacture online counts for production behavior.

Allow future expansion for:

* trends;
* 24h graph;
* server activity.

Keep it compact.

---

# 15. Activity Layer

Build the UI around a unified activity read model.

Conceptual events:

```text
SERVER_ONLINE
SERVER_UPDATE
SERVER_NEWS
NEW_SERVER
RESOURCE_RELEASE
RESOURCE_UPDATE
NEW_DISCUSSION
DISCUSSION_REPLY
NEW_REVIEW
```

The UI may display examples like:

```text
SERVER UPDATE
MTA Province
Version 1.8.5

RESOURCE RELEASE
Advanced Vehicle System
v2.4

NEW DISCUSSION
Problem installing resource X
```

Do not create noisy activity items for:

* likes;
* raw views;
* private purchases;
* private follows;
* private memberships.

---

# 16. Market

Market must support:

```text
Resources
Services
Free
```

Filters:

```text
Category
Price
Compatibility
Verified
Health
Rating
Sales
Updated
```

Future-compatible filters may include:

```text
Discount
Bundle
Creator
3D
Live Demo
```

Only expose features that actually exist.

---

# 17. Resource Card

Resource cards must prioritize:

```text
Title
Creator
Price
Trust
Rating
Sales
Compatibility
Health
```

Example conceptual card:

```text
Advanced Vehicle System

Verified
Compatible
Healthy

MTA 1.6+
2 dependencies
4.9
1,240 sales

$29.99
```

Do not display every piece of metadata at the same visual weight.

Use hierarchy.

---

# 18. Resource Page

Create a mature entity surface:

```text
Gallery / Preview

Advanced Vehicle System
ScriptMaster

Verified
Compatible
Healthy

$29.99
[ Buy ]
```

Tabs:

```text
Overview
Features
Compatibility
Dependencies
Versions
Reviews
Support
```

Future-compatible tabs:

```text
Live Demo
3D
```

Do not implement future backend functionality merely to create placeholder tabs.

---

# 19. Trust UI

Trust is a platform-wide visual layer.

Potential states:

```text
Verified
Compatible
Healthy
Official
Community
Verified Creator
Verified Server
Verified Interaction
```

Use them consistently in:

* resources;
* servers;
* creators;
* reviews;
* search;
* activity.

Do not create random badge designs per page.

---

# 20. Compatibility UI

Human-readable compatibility section:

```text
MTA
Supported

OS
Windows / Linux

Architecture
x64

Dependencies
2

Required modules
1

Required resources
3
```

Statuses:

```text
SUPPORTED
PARTIAL
UNSUPPORTED
UNKNOWN
```

Make this understandable to normal server owners.

---

# 21. Dependency UI

Inside Resource:

```text
Dependencies

Resource A
Resource B
Native Module
```

Future-compatible with interactive dependency graph.

Do not expose private/internal dependency details that are not intended for users.

---

# 22. Health UI

Use aggregated metrics.

Example:

```text
Health 98%

Installation success 99.1%
Update success 98.7%
Refund rate 0.8%
```

Do not display raw private telemetry.

---

# 23. Version UI

Resource page must support version history.

Example:

```text
v2.4.0   VERIFIED
v2.3.2   VERIFIED
v2.3.1   DEPRECATED
```

Show:

* release date;
* compatibility;
* changelog;
* update availability;
* rollback relationship where relevant.

---

# 24. Free Resources

Give free resources a meaningful discovery surface.

Home:

```text
Free Resources
42 new
```

Cards may show:

* Free;
* Downloads/acquisitions;
* compatibility;
* reviews;
* creator;
* current version.

Do not visually classify free content as low-quality.

---

# 25. Services

Services use their own card treatment.

Example:

```text
MTA UI Development

$120
Delivery 3 days
3 revisions

ScriptMaster
4.9
```

Service page:

```text
Overview
Requirements
Delivery
Revisions
Reviews
Order
```

Do not force services into resource-specific UI.

---

# 26. Servers

Server discovery:

```text
Live
Popular
New
Verified
Categories
```

Server card:

```text
MTA Province
Verified Server

842 / 1000
ONLINE

Peak 913
4.8
127 reviews
```

Server page:

```text
Overview
Live
News
Updates
Reviews
Community
Statistics
```

Resources section remains owner-controlled.

Do not expose server-resource relationships unless public configuration permits them.

---

# 27. Server Statistics

Provide:

```text
24H
7D
30D
```

Metrics:

```text
Peak
Average
Uptime
Trend
```

Do not expose private infrastructure details.

---

# 28. Creator

Creator profile:

```text
ScriptMaster
Verified Creator

12.4k sales
4.9 rating
84 resources
17 services
```

Tabs:

```text
Resources
Services
Reviews
Updates
About
```

Future-compatible:

```text
Publications
Followers
Analytics
SLA
```

---

# 29. Community

Community hub:

```text
Latest
Active
Following
Servers
Categories
```

Thread surface:

```text
Title
Author
Context
Replies
Views
Last activity
```

Context may reference:

```text
Server
Resource
Creator
General
```

---

# 30. News / Content

Unify content presentation.

Current content:

```text
Server News
Server Updates
```

Future:

```text
Articles
Creator Publications
```

Do not create disconnected visual systems for each content type.

---

# 31. Personal Space — My MTA

Create a coherent user area.

Navigation:

```text
Overview
Purchases
Licenses
Favorites
Following
Notifications
My Servers
My Resources
My Services
Balance
```

Overview must prioritize:

```text
Current
Since last visit
```

Examples:

```text
3 new updates
2 new discussions
1 server update
1 new review
```

The dashboard should feel personal, not like a generic admin panel.

---

# 32. Notifications

Notification center:

```text
Today

New version
Advanced Vehicle System v2.4

Server update
MTA Province

New reply
Technical Support

Payment
Purchase completed
```

Future-compatible with:

```text
Price Drop
Creator Release
License Expiring
Security Alert
```

---

# 33. Balance / Money Center

Balance must be visible in the global account control.

Example:

```text
Holo
$243.60
```

Account menu:

```text
Balance
Transactions
Purchases
Licenses
```

Seller context:

```text
Available
Pending
Sales
Payouts
Fees
Transactions
```

Do not create duplicated financial surfaces unless there is a real domain reason.

---

# 34. Checkout

Checkout should support the existing product model.

Display:

```text
Items
Discount
Subtotal
Fees
Total
Payment
```

Future-compatible with:

* multiple resources;
* services;
* discounts;
* bundles.

Do not trust frontend-calculated totals.

---

# 35. Creator Studio

Creator/seller context:

```text
Resources
Services
Orders
Sales
Discounts
Payouts
Analytics
Reviews
```

Primary action:

```text
Publish
```

---

# 36. Resource Publishing UX

Use progressive disclosure.

Suggested steps:

```text
Basic Info
↓
Pricing
↓
Compatibility
↓
Dependencies
↓
Artifact
↓
Validation
↓
Sandbox
↓
Moderation
↓
Publish
```

Technical complexity should appear only where needed.

---

# 37. Future Feature Placement

Do not put all future features into primary navigation.

Correct placement:

```text
Live Demo
→ Resource

3D Studio
→ Resource / Creator Studio

Dependency Graph
→ Resource / Compatibility

Leak Radar
→ Creator / Security / Admin

Advanced Analytics
→ Creator / Server statistics

Bundles
→ Market

Promocodes
→ Creator Studio

Subscriptions
→ Personal / Creator context

Custom Development
→ Future Market context

Bidding
→ Future Market context
```

This is mandatory for avoiding navigation bloat.

---

# 38. Advertising Architecture

Create a reusable conceptual placement system:

```text
SponsoredPlacement
```

Possible contexts:

```text
Home Hero
Market Featured
Server Featured
Community Event
Search Promotion
Creator Promotion
```

Do not implement these as unrelated components.

Each placement should be structurally compatible with:

```text
campaign
placement
priority
start
end
creative
status
```

---

# 39. Responsive Behavior

Desktop is primary.

Expected transition:

```text
3 columns
↓
2 columns
↓
1 column
```

When width decreases:

* sidebar may collapse;
* right rail moves below;
* cards reflow;
* hierarchy stays the same.

Do not simply scale the desktop layout down.

---

# 40. Accessibility

Every redesigned surface requires:

* keyboard navigation;
* visible focus;
* semantic controls;
* accessible labels;
* readable contrast;
* reduced-motion handling;
* clear error states.

---

# 41. Loading / Empty / Error

Every important surface needs explicit:

```text
Loading
Empty
Error
Unauthorized
Unavailable
Degraded
```

Never use fake activity to fill empty states.

---

# 42. Shared Component System

Before building pages, establish reusable primitives where appropriate:

```text
AppShell
Sidebar
Topbar
Search
AccountMenu
ThemeToggle
PromotionHero
LiveStrip
SectionHeader
EntityCard
ResourceCard
ServerCard
CreatorCard
ActivityItem
NewsCard
DiscussionItem
Badge
Status
StatsCard
NotificationItem
TransactionRow
```

Avoid creating visually unique versions of the same concept page-by-page.

---

# 43. Design Tokens

Centralize:

```text
colors
spacing
radii
shadows
typography
breakpoints
motion
borders
surface levels
```

Light and dark theme must use the same semantic token names.

Do not scatter raw colors throughout components.

---

# 44. Typography

Use clear type hierarchy.

Recommended conceptual levels:

```text
Display
H1
H2
H3
Body
Small
Metadata
Label
```

Avoid oversized headings that consume the entire viewport.

---

# 45. Motion

Use restrained motion for:

* page transitions;
* cards;
* live states;
* counters;
* notifications;
* modal transitions.

No permanent visual noise.

---

# 46. Performance

Do not regress existing application performance.

Requirements:

* bounded queries;
* no unnecessary waterfall;
* optimized images;
* lazy loading where useful;
* limited client state;
* reuse API responses;
* avoid expensive client rendering for static content.

---

# 47. Backend Boundary

Do not modify backend/domain code unless strictly required for missing data needed by the new UI.

If required:

```text
inspect existing API
→ verify missing field
→ extend current contract
→ add tests
→ implement
→ document
```

Never create a parallel API merely because the frontend needs a different representation.

---

# 48. Testing

After each major stage run:

```text
unit tests
typecheck
lint
build
E2E
```

At minimum validate:

### Shell

* sidebar expand/collapse;
* route navigation;
* theme toggle;
* account menu;
* balance;
* search.

### Home

* hero;
* live;
* servers;
* resources;
* activity;
* right rail.

### Market

* filters;
* sorting;
* cards;
* free content;
* services.

### Entities

* resource;
* server;
* creator;
* community;
* news.

### Personal

* dashboard;
* purchases;
* licenses;
* notifications;
* balance.

---

# 49. Visual QA

Perform browser-based verification at:

```text
1440×900
1920×1080
```

Check:

* horizontal density;
* empty space;
* sidebar width;
* topbar balance;
* search position;
* visual hierarchy;
* typography;
* dark mode;
* light mode;
* cards;
* overflow;
* alignment;
* scrolling;
* loading states;
* error states.

A page is not complete because it builds successfully.

---

# 50. Implementation Order

Strict sequence:

## Phase A — Audit

Map current frontend and identify reusable components.

## Phase B — Foundation

Implement:

```text
Design tokens
Typography
Colors
Theme
Base components
```

## Phase C — Global Shell

Implement:

```text
Sidebar
Topbar
Search
Account
Balance
Theme
```

## Phase D — Home

Implement:

```text
Sponsored Hero
Live MTA
Popular
Resources
News
Discussions
Activity
Right rail
```

## Phase E — Market

Implement:

```text
Resource listing
Free
Services
Filters
Sorting
Trust UI
```

## Phase F — Entity Surfaces

Implement:

```text
Resource
Server
Creator
Community
News
```

## Phase G — Personal

Implement:

```text
My MTA
Purchases
Licenses
Notifications
Balance
```

## Phase H — Creator

Implement:

```text
Creator Studio
Resources
Services
Sales
Discounts
Analytics
```

## Phase I — QA

Run complete desktop/light/dark/browser verification.

---

# 51. Git Discipline

Do not make one giant opaque commit.

Prefer logical commits:

```text
feat(ui): establish design system
feat(ui): redesign application shell
feat(ui): redesign home discovery
feat(ui): redesign marketplace surfaces
feat(ui): redesign entity pages
feat(ui): redesign personal workspace
feat(ui): redesign creator workspace
test(ui): add plan-015 browser coverage
docs(plan-015): record implementation
```

---

# 52. Documentation

After implementation update the canonical project documentation.

Record:

* what changed;
* reused components;
* new shared components;
* design tokens;
* theme architecture;
* route changes;
* API changes, if any;
* browser verification;
* known limitations;
* future-compatible surfaces.

Do not claim that future features such as Live Demo, 3D Studio or Leak Radar are implemented merely because the UI has reserved space for them.

---

# 53. Definition of Done

PLAN-015 is complete only when:

```text
[ ] Global shell redesigned
[ ] Sidebar expanded/collapsed
[ ] Topbar redesigned
[ ] Search integrated
[ ] Account + balance integrated
[ ] One theme toggle
[ ] Light theme complete
[ ] Dark theme complete

[ ] Home redesigned
[ ] Sponsored hero
[ ] Live MTA
[ ] Popular servers
[ ] New resources
[ ] News
[ ] Discussions
[ ] Activity
[ ] Creator rail

[ ] Market redesigned
[ ] Resources
[ ] Free
[ ] Services
[ ] Filters
[ ] Sorting

[ ] Resource surface redesigned
[ ] Server surface redesigned
[ ] Creator surface redesigned
[ ] Community surface redesigned
[ ] News surface redesigned

[ ] My MTA redesigned
[ ] Purchases
[ ] Licenses
[ ] Notifications
[ ] Balance

[ ] Creator Studio redesigned

[ ] Loading states
[ ] Empty states
[ ] Error states
[ ] Accessibility
[ ] Desktop QA
[ ] Light QA
[ ] Dark QA
[ ] Browser E2E
[ ] Build/typecheck/lint pass
[ ] Documentation updated
```

---

# 54. Final UX Test

Before declaring the plan complete, open the site as a normal user and answer:

```text
1. Do I understand what MTA Market is within 5 seconds?
2. Can I immediately see what is happening in MTA?
3. Can I find a server?
4. Can I find a resource?
5. Can I distinguish paid/free/service?
6. Can I understand whether a resource is trustworthy?
7. Can I see my balance without entering a dashboard?
8. Can I navigate without sidebar clutter?
9. Does light mode feel intentional?
10. Does dark mode feel intentional?
11. Does the site look dense and professional on desktop?
12. Is advertising visible but not intrusive?
13. Does the product feel like one ecosystem rather than several unrelated pages?
```

If any answer is no, continue iteration before marking PLAN-015 complete.

---

# 55. Final Principle

The goal is NOT:

> make the current site prettier.

The goal is:

> **build the visual and UX foundation of the future MTA Market.**

The interface must be:

```text
compact
desktop-first
mature
coherent
commercially viable
trust-oriented
discoverable
extensible
```

while preserving the existing technical foundation.

Do not redesign the product around what exists today only.

Design the shell and information architecture for the product MTA Market is becoming.
