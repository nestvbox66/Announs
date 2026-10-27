\#\# VIEW SPECIFICATION: FLY HOME SCREEN (\`/fly\`)


\#\#\# 1. Global Navigation Bar (Persistent Header)

- \*\*Container Geometry\*\*: Fixed height of ~128px spanning edge-to-edge (0px margin, breaking the 64px grid margin intentionally).

- \*\*Background Fill\*\*: Standard system gradient:

  \`linear-gradient(180deg, \#00345C 0%, \#00345C 13%, \#001626 51%, \#00345C 87%, \#00345C 100%)\`

  \*Note\*: Due to the ~128px container height limit, the gradient displays minimal color shifting before reaching the lower bounding stroke.

- \*\*Lower Boundary\*\*: 1px horizontal separator stroke in \`\#45AFFF\` at 30% to 40% opacity.

- \*\*Brand Identity\*\*: Left-aligned ANNOUNS attitude indicator mark (\`\#45AFFF\`).

- \*\*Section Navigation Track\*\*: Centered horizontal link group:

  - Items: \`FLY\`, \`USER HUB\`, \`SETTINGS\`

  - Typography: Bahnschrift Bold SemiCondensed, uppercase, text size 16px to 18px.

  - Inactive State: Text color \`\#DBF0FF\` at 70% opacity. No border or underline.

  - Active State (\`FLY\`): Text color \`\#FFFFFF\` (100% opacity) with a localized sky-blue radial glow (\`\#45AFFF\` at 25% opacity) centered behind the active word.

  - Active Underline: Exact text-width underline bar (height: 3px to 4px) anchored flush to the bottom boundary of the header in \`\#45AFFF\`.


---


\#\#\# 2. Main Content Layout ("PLOT A FLIGHT")

- \*\*Container Margins\*\*: 64px horizontal outer margins (desktop 12-column grid container), ~64px margin from the bottom viewport boundary on standard 1920x1080 resolution.

- \*\*Section Title\*\*:

  - String: \`PLOT A FLIGHT\`

  - Typography: Bahnschrift Bold SemiCondensed, uppercase, tracking-wider, text size 14px to 16px.

  - Color: \`\#DBF0FF\` (or muted secondary blue \`\#6EC2FF\`).

  - Separation: 16px vertical gap to the card grid.


---


\#\#\# 3. Flight Action Tiles (4-Column Card Grid)

- \*\*Grid Layout\*\*: 4 cards positioned horizontally.

  - Width: Exactly 3 columns of the 12-column grid per card (24px gutter between cards).

  - Height: Fixed vertical span occupying ~80% of the remaining screen height.

  - Border Radius: 0px (strict rectangular avionics framing).

- \*\*Image Integration\*\*:

  - Background imagery baked directly into each card surface.

  - Blend Mode: \`mix-blend-mode: soft-light\` over base fill.

  - Image Content: Atmospheric flight imagery (dark, high-contrast flight deck / exterior aerial photography).


---


\#\#\# 4. Tile Visual States & Color Hierarchy


\#\#\#\# Card 1: \`SIMBRIEF IMPORT\` (Primary Action)

- \*\*Background Fill\*\*: Base \`\#1A5C00\` (Dark Green) under the blended flight image.

- \*\*Border\*\*: 1px to 2px solid \`\#43E600\` (Positive CTA Bright Green).

- \*\*Typography (Center)\*\*: Bahnschrift Bold, uppercase, \`\#FFFFFF\`, text size 24px to 28px.

- \*\*Hover Behavior\*\*: Reveals a concise operational description positioned directly beneath the centered title in Bahnschrift Condensed (\`\#DBF0FF\`, 14px).


\#\#\#\# Card 2: \`ISLAND HOPPING\` (Weekly Campaign)

- \*\*Background Fill\*\*: Base \`\#002540\` / \`\#001626\` (Avionics Blue) under the blended flight image.

- \*\*Border\*\*: 1px to 2px solid \`\#E600D2\` (Active Highlight Magenta).

- \*\*Top Metadata Header\*\*:

  - Left Annunciator: \`WEEKLY CAMPAIGN\` (Bahnschrift Bold SemiCondensed, 12px, tracking-widest, \`\#FFFFFF\` or \`\#DBF0FF\`).

  - Right Countdown: \`Ends in \[X\] days\` (Bahnschrift Condensed, 12px, \`\#DBF0FF\` at 80% opacity).

  - Placement: Absolute top inset with 16px margin from card borders.

- \*\*Typography (Center)\*\*: Bahnschrift Bold, uppercase, \`\#FFFFFF\`, text size 24px to 28px.

- \*\*Hover Behavior\*\*: Reveals operational guide text beneath the title in Bahnschrift Condensed (\`\#DBF0FF\`, 14px).


\#\#\#\# Card 3: \`FLIGHT LOOKUP\` & Card 4: \`CUSTOM FLIGHT\` (Standard Interactive Tiles)

- \*\*Background Fill\*\*: Base \`\#002540\` (Secondary Dark Blue) under the blended flight image.

- \*\*Border\*\*: 1px solid \`\#45AFFF\` (Muted/Idle Sky Blue) or \`\#2C6591\`.

- \*\*Hover State\*\*: Border sharpens to \`\#45AFFF\` at 100% opacity; overlay reveals the functional description beneath the title in Bahnschrift Condensed (\`\#DBF0FF\`, 14px).

- \*\*Typography (Center)\*\*: Bahnschrift Bold, uppercase, \`\#FFFFFF\`, text size 24px to 28px.


# \#\# VIEW SPECIFICATION: FLIGHT SETUP (\`/fly/setup\`)


\#\#\# 1. Screen Architecture (12-Column Grid Split)

- \*\*Container\*\*: Standard 12-column desktop grid (64px outer horizontal margins, 24px gutters).

- \*\*Header\*\*: \`FLIGHT SETUP\` in H1 (\`Bahnschrift Bold\`, uppercase, \`\#FFFFFF\`) positioned above the left column.

- \*\*Left Zone (3 Columns)\*\*: Fixed-width operational sidebar housing flight summary telemetry and global voice dropdowns.

- \*\*Right Zone (9 Columns)\*\*: Interactive configuration workspace containing the dual-order tabber, the inner event grid, and the bottom execution bar.


---


\#\#\# 2. Left Zone: Flight Telemetry & Voice Configuration (3 Columns)


\#\#\#\# 2.1 Flight Summary Box

- \*\*Container\*\*: 1pt solid \`\#45AFFF\` border, fill \`\#001626\` (or deep base navy), 16pt internal padding.

- \*\*Top Row\*\*:

  - Left: \`FROM\` (\`Bahnschrift Bold SemiCondensed\`, 11px, \`\#45AFFF\`).

  - Center: Flight Callsign / Number, e.g., \`UNITED AIRLINES 155\` (\`Bahnschrift Bold SemiCondensed\`, 13px, \`\#FFFFFF\`).

  - Right: \`TO\` (\`Bahnschrift Bold SemiCondensed\`, 11px, \`\#45AFFF\`).

- \*\*Middle Row (Primary Telemetry)\*\*:

  - Left & Right: Origin and Destination IATA/ICAO codes (\`GUM\`, \`TKK\`) in \`Bahnschrift Bold\`, 40px–44px, \`\#FFFFFF\`.

- \*\*Bottom Metadata\*\*:

  - Sub-row 1: Full airport names (\`Bahnschrift Condensed\`, 11px, \`\#DBF0FF\`, left and right aligned).

  - Sub-row 2: Aircraft type on the left (\`BOEING 737 MAX 8\` in \`Bahnschrift Bold Condensed\`, 11px, \`\#FFFFFF\`) and passenger count on the right (\`234 PASSENGERS\` in \`Bahnschrift Condensed\`, 11px, \`\#DBF0FF\`).


\#\#\#\# 2.2 Voice Selectors (\`VOICE\`)

- \*\*Section Header\*\*: \`VOICE\` in H2 (\`Bahnschrift Bold SemiCondensed\`, uppercase, \`\#FFFFFF\`), 24px top margin.

- \*\*Dropdown Controls\*\*: Stacked vertically with 16px spacing (\`Language\`, \`Door Agent Voice\`, \`Cabin Crew Voice\`, \`Captain Voice\`).

  - \*\*Label\*\*: \`Bahnschrift Bold SemiCondensed\`, 13px, \`\#FFFFFF\`, 4px bottom margin.

  - \*\*Select Box\*\*: Matches standard Type-in Box rules (Height: 36px, Fill: \`\#00345C\`, Border: 1pt solid \`\#45AFFF\`, Text: \`\#FFFFFF\`, right-aligned \`\#45AFFF\` chevron). Active state uses Fill \`\#005699\` and Border \`\#33A6FF\`.


---


\#\#\# 3. Right Zone: Dual-Order Tabber & Event Workspace (9 Columns)


\#\#\#\# 3.1 First-Order Tabs (Primary Mode Switch)

- \*\*Structure\*\*: 3 equal-width horizontal tabs spanning the full 9-column width:

  1. \`FLIGHT EVENTS\`

  2. \`SPECIAL CABIN EVENTS\`

  3. \`PLANNED SERVICES\`

- \*\*Styling\*\*:

  - Active Tab: Fill \`\#2C6591\`, Text \`\#FFFFFF\` (\`Bahnschrift Bold SemiCondensed\`, uppercase).

  - Inactive Tab: Fill \`\#0F4066\`, Text \`\#DBF0FF\`.


\#\#\#\# 3.2 Second-Order Tabs (Flight Phases — Exclusive to \`FLIGHT EVENTS\`)

- \*\*Visibility\*\*: Renders directly beneath the First-Order bar ONLY when \`FLIGHT EVENTS\` is active.

- \*\*Fluent Tab Overflow Solution\*\*: Because flight phases vary dynamically in count, implement the second-order track as a single-row flex container (\`display: flex; overflow-x: auto; scrollbar-width: none;\`) with \`flex: 1 0 auto\` (min-width: 96px) per tab, or wrap clean horizontal scroll paddles at the container edges if phase count exceeds 9 items.

- \*\*Styling\*\*:

  - Active Phase Tab (e.g., \`Gate\`): Fill \`\#2C6591\` (or matches workspace container top), Text \`\#FFFFFF\`.

  - Inactive Phase Tab: Fill \`\#002540\` (Secondary Background), Text \`\#DBF0FF\`.


\#\#\#\# 3.3 Main Tab Workspace Container

- \*\*Container\*\*: Border 1pt solid \`\#45AFFF\`, Fill \`\#001626\` / \`\#002540\`, internal padding 24px.

- \*\*Internal Grid (Breaking the Master Grid)\*\*:

  - For \`FLIGHT EVENTS\`: Establish an isolated \*\*3-column CSS Grid\*\* (\`grid-template-columns: repeat(3, 1fr); gap: 16px;\`) displaying a \*\*maximum of 6 event cards\*\* per phase (3 columns × 2 rows).

  - For \`SPECIAL CABIN EVENTS\` and \`PLANNED SERVICES\`: Omit second-order tabs. Refactor the existing production UX components from the live codebase to strictly use this UI system's color tokens, typography, and 1pt rectangular borders inside this container.


---


\#\#\# 4. Flight Event Card Component (4 Reactive States)


\#\#\#\# Card Anatomy

- \*\*Dimensions\*\*: Rectangular container (0px radius), 16px internal padding, flex-column layout justifying the selector at the bottom.

- \*\*Title\*\*: Event Name (\`Bahnschrift Bold SemiCondensed\`, 16px, \`\#FFFFFF\`).

- \*\*Description\*\*: Operational behavior (\`Bahnschrift Condensed\`, 13px, \`\#DBF0FF\`, 8px top margin).

- \*\*Voiceover Tag\*\*: \`Voiceover: \[Role\]\` (\`Bahnschrift Condensed\`, 14px, label in \`\#FFFFFF\`, role value in \`\#45AFFF\`).

- \*\*Mode Selector\*\*: 3-way segmented control bar (\`OFF\` | \`PACKAGE\` | \`AI\`) anchored at the bottom of the card (height: 24px, 1pt \`\#2C3E4D\` dividers).


\#\#\#\# Reactive State Styling

1. \*\*AI Generation Mode (\`AI\` Selected)\*\*:

   - Card Border: 1pt solid \`\#E600D2\` (Highlight Magenta).

   - Card Fill: \`\#001626\`.

   - Active Segment (\`AI\`): Fill \`\#5C0053\`, Border 1pt solid \`\#E600D2\`, Text \`\#FFFFFF\`.

2. \*\*Package Mode (\`PACKAGE\` Selected)\*\*:

   - Card Border: 1pt solid \`\#E68B00\` (Warning/Package Orange).

   - Card Fill: \`\#001626\`.

   - Active Segment (\`PACKAGE\`): Fill \`\#5C3800\`, Border 1pt solid \`\#E68B00\`, Text \`\#FFFFFF\`.

3. \*\*Off Mode (\`OFF\` Selected)\*\*:

   - Card Border: 1pt solid \`\#7A0000\` (Muted Red/Off Stroke).

   - Card Fill: \`\#1E2C38\` (Muted/Dimmed surface).

   - Text & Labels: Dimmed to \`\#757575\`.

   - Active Segment (\`OFF\`): Fill \`\#5C0000\` (Dark Red), Border 1pt solid \`\#CC0000\`, Text \`\#FFFFFF\`.

4. \*\*Disabled / Locked State (Premium Tier Required)\*\*:

   - Card Border: 1pt solid \`\#2C3E4D\`.

   - Card Fill: \`\#1E2C38\`.

   - Text & Controls: All text and all 3 selector segments greyed out (\`\#757575\`), \`pointer-events: none\` on selector.

   - Upsell Prompt: Display \`Available with a Pilot Membership\` above the Voiceover line (\`Bahnschrift Condensed\`, 12px, \`\#FFFFFF\`, with \`Pilot Membership\` highlighted in \`\#E600D2\`).


---


\#\#\# 5. Bottom Control Bar (Right Zone Footer)

- \*\*Layout\*\*: Positioned beneath the Main Tab Workspace Container, spanning the 9-column width. Uses a horizontal flex layout (\`justify-content: space-between; align-items: flex-end;\`) with space for up to \*\*two compact segmented adjusters\*\* on the left and the primary action button on the right.

- \*\*Micro-Adjuster Widgets (e.g., \`Voiceover Attitude\`)\*\*:

  - Label: \`Bahnschrift Condensed\`, 13px, \`\#FFFFFF\`, 4px bottom margin.

  - Segmented Bar: Compact 4-option horizontal selector (\`Formal\` | \`Gregarious\` | \`Tourist\` | \`Relaxed\`), height 24px. Inactive segments use \`\#1E2C38\` fill with \`\#757575\` text; active segment uses \`\#5C0053\` fill with 1pt \`\#E600D2\` border and \`\#FFFFFF\` text.

  - Sub-caption: Dynamic 1-line description beneath the bar (\`Bahnschrift Condensed\`, 11px, \`\#DBF0FF\`).

- \*\*Primary Execution CTA (\`START FLIGHT\`)\*\*:

  - Dimensions: Width ~240px (or 2 columns wide), Height 44px.

  - Enabled Styling: Fill \`\#43E600\`, Text \`\#0B2600\` (\`Bahnschrift Bold\`, uppercase, 16px), 0px border.

  - Disabled Styling: Fill \`\#113B00\`, Text \`\#0A2400\`.


# \#\# VIEW SPECIFICATION: CAMPAIGN OVERVIEW (\`/fly/campaign\`)


\#\#\# 1. Screen Architecture (12-Column Grid)

- \*\*Container\*\*: Standard 12-column desktop grid (64px outer horizontal margins, 24px gutters).

- \*\*Breadcrumb Header\*\*: \`FLY \> CAMPAIGN\` in H1 (\`Bahnschrift Bold\`, uppercase). \`FLY\>\` uses \`\#45AFFF\` and \`CAMPAIGN\` uses \`\#FFFFFF\`\[cite: 13\].

- \*\*Top Hero Banner (12 Columns)\*\*: Full-width horizontal banner positioned directly beneath the breadcrumb header with a 16px top margin and 32px bottom margin\[cite: 13\].

- \*\*Lower Workspace Split (3 / 9 Scheme)\*\*:

  - \*\*Left Zone (3 Columns)\*\*: Campaign briefing, external reference link, and overall completion status\[cite: 13\].

  - \*\*Right Zone (9 Columns)\*\*: Horizontal flight leg cards, allocating 3 columns per individual flight card (3 cards visible across the 9-column span)\[cite: 13\].


---


\#\#\# 2. Top Campaign Hero Banner (12 Columns)

- \*\*Dimensions\*\*: Spans all 12 columns, fixed compact vertical height (~160px to 180px), 0px border radius\[cite: 13\].

- \*\*Border\*\*: 1pt solid \`\#45AFFF\` (or \`\#2C6591\`)\[cite: 13\].

- \*\*Background\*\*: High-contrast atmospheric aviation photography spanning the full container, masked with a dark left-side gradient (\`linear-gradient(90deg, rgba(0, 22, 38, 0.85) 0%, rgba(0, 22, 38, 0.0) 60%)\`) to guarantee title legibility\[cite: 13\].

- \*\*Banner Title\*\*: Campaign Name (e.g., \`ISLAND HOPPING\`) vertically centered on the left with a 32px left inset, rendered in \`Bahnschrift Bold\`, uppercase, 36px to 44px, \`\#FFFFFF\`\[cite: 13\].


---


\#\#\# 3. Left Zone: Campaign Briefing & Progress (3 Columns)

- \*\*Container\*\*: Unboxed, sitting directly over the master background gradient\[cite: 13\].

- \*\*Sub-Header\*\*: Campaign tagline (e.g., \`A SMALL PLANE FOR A BIG ADVENTURE\`) in \`Bahnschrift Bold SemiCondensed\`, uppercase, 14px, \`\#FFFFFF\`, 16px bottom margin\[cite: 13\].

- \*\*Description Body\*\*: Multi-paragraph campaign lore and operational summary in \`Bahnschrift Condensed\`, 14px, \`\#DBF0FF\`, 16px spacing between paragraphs\[cite: 13\].

- \*\*External Reference Link\*\*: Raw URL or reference link at the bottom of the text stack in \`Bahnschrift Condensed\`, 14px, \`\#DBF0FF\` (or \`\#6EC2FF\` highlight)\[cite: 13\].

- \*\*Completion Status Box\*\*:

  - Positioned 32px below the text block\[cite: 13\].

  - Dimensions: Full width of the 3-column zone (or padded inset), height 40px, 0px border radius\[cite: 13\].

  - Styling: Fill \`\#5C0053\`, Border 1pt solid \`\#E600D2\`\[cite: 13\].

  - Text: \`COMPLETION: \[X\]%\` centered in \`Bahnschrift Condensed\`, uppercase, 15px, \`\#FFFFFF\`\[cite: 13\].


---


\#\#\# 4. Right Zone: Campaign Flight Leg Cards (9 Columns — 3 Columns Per Card)


\#\#\#\# 4.1 Card Container & Airline Header

- \*\*Grid Allocation\*\*: Each flight card occupies 3 columns of the master 12-column grid (3 cards across the 9-column zone, separated by 24px gutters). If a campaign exceeds 3 flights, wrap into a second row with a 24px vertical gap or enable horizontal track scrolling.

- \*\*Card Frame\*\*: Fill \`\#001626\` (or \`\#002540\` Secondary Background), Border 1pt solid \`\#45AFFF\`, 16px internal padding, flex-column layout justifying the action stack at the bottom\[cite: 13\].

- \*\*Airline Banner Box\*\*:

  - Top full-width rectangular container inside the card padding (Height: ~64px to 72px)\[cite: 13\].

  - Background: \`\#D9D9D9\` / light neutral surface with a centered \`\#FFFFFF\` square/rectangular badge housing the airline logo (e.g., \`UNITED\`)\[cite: 13\].


\#\#\#\# 4.2 Telemetry & Flight Leg Details

- \*\*Primary Route & Duration Row\*\* (16px top margin from Airline Banner):

  - Flex row (\`justify-content: space-between; align-items: baseline;\`)\[cite: 13\].

  - \*\*Left (Origin Code)\*\*: IATA/ICAO code (e.g., \`GUM\`) in \`Bahnschrift Bold SemiCondensed\`, 28px, \`\#FFFFFF\`\[cite: 13\].

  - \*\*Center (Flight Time)\*\*: Duration string (e.g., \`1h 30m\`) positioned directly between Origin and Destination in \`Bahnschrift Bold SemiCondensed\`, 15px, \`\#FFFFFF\`\[cite: 13\].

  - \*\*Right (Destination Code)\*\*: IATA/ICAO code (e.g., \`TKK\`) in \`Bahnschrift Bold SemiCondensed\`, 28px, \`\#FFFFFF\`\[cite: 13\].

- \*\*Airport Sub-Labels\*\*:

  - Flex row directly below the route row (\`justify-content: space-between\`)\[cite: 13\].

  - Full airport names in \`Bahnschrift Condensed\`, uppercase, 9px to 10px, \`\#DBF0FF\`\[cite: 13\].

- \*\*Aircraft Equipment\*\*:

  - Placed 8px below the origin airport name (left-aligned)\[cite: 13\].

  - String (e.g., \`BOEING 737 MAX 8\`) in \`Bahnschrift Bold SemiCondensed\`, uppercase, 13px, \`\#FFFFFF\`\[cite: 13\].

- \*\*Leg Description\*\*:

  - Placed 12px below the aircraft string\[cite: 13\].

  - Leg briefing text in \`Bahnschrift Condensed\`, 13px, \`\#DBF0FF\`, \`flex-grow: 1\` to push the bottom status and CTA bars flush to the card base\[cite: 13\].


\#\#\#\# 4.3 Bottom Status Indicator & Execution CTA

- \*\*Status / Reward Bar\*\*:

  - Full-width slim rectangular bar above the CTA button (Height: 24px, 8px bottom margin)\[cite: 13\].

  - \*\*State A — Uncompleted / Bonus XP Available\*\*:

    - Fill: \`\#5C0053\`, Border: 1pt solid \`\#E600D2\`\[cite: 13\].

    - Text: \`+\[X\] BONUS XP\` centered in \`Bahnschrift Condensed\`, uppercase, 11px, \`\#FFFFFF\`\[cite: 13\].

  - \*\*State B — Completed Leg\*\*:

    - Fill: \`\#5C3800\`, Border: 1pt solid \`\#E68B00\`\[cite: 13\].

    - Text: \`COMPLETED!\` centered in \`Bahnschrift Condensed\`, uppercase, 11px, \`\#FFFFFF\`\[cite: 13\].

- \*\*Primary Action Button (\`SEND TO SIMBRIEF\`)\*\*:

  - Full-width rectangular button anchored at the bottom of the card (Height: 40px, 0px border radius)\[cite: 13\].

  - Enabled Styling: Fill \`\#43E600\`, Text \`\#0B2600\` (\`Bahnschrift Bold\`, uppercase, 15px), 0px border\[cite: 13\].

  - Disabled Styling: Fill \`\#113B00\`, Text \`\#0A2400\`, Border 1px solid \`\#1A5C00\`.


# \#\# VIEW SPECIFICATION: FLIGHT LOOKUP (\`/fly/lookup\`)


\#\#\# 1. Screen Architecture (12-Column Grid — 2 / 10 Split)

- \*\*Container\*\*: Standard 12-column desktop grid (64px outer horizontal margins, 24px gutters)\[cite: 14\].

- \*\*Breadcrumb Header\*\*: \`FLY \> FLIGHT LOOKUP\` in H1 (\`Bahnschrift Bold\`, uppercase) positioned above the left column\[cite: 14, 15\]. \`FLY\>\` uses \`\#45AFFF\` and \`FLIGHT LOOKUP\` uses \`\#FFFFFF\`\[cite: 14, 15\].

- \*\*Left Zone (2 Columns)\*\*: Dedicated search filter stack containing type-in fields with dynamic autocomplete dropdown capabilities and execution buttons\[cite: 14, 15\].

- \*\*Right Zone (10 Columns)\*\*: Data table displaying matching flight routes\[cite: 14, 15\].


---


\#\#\# 2. Left Zone: Search Filter Stack (2 Columns)


\#\#\#\# 2.1 Field Sizing & Autocomplete Behavior

- \*\*Type-in Box Styling\*\*: Idle state uses Fill \`\#00345C\`, Border 1pt solid \`\#45AFFF\`, Text \`\#FFFFFF\` (\`Bahnschrift Condensed\`), height 32px to 36px, 0px border radius\[cite: 8, 14\]. Active/typing state switches to Fill \`\#005699\` and Border 1pt solid \`\#33A6FF\`\[cite: 8, 14\].

- \*\*Dynamic Autocomplete\*\*: All type-in fields support dynamic dropdown suggestion lists anchored flush beneath the active input box when typing.

- \*\*Relevance Width Hierarchy\*\*:

  - \*\*Tier-1 Fields (2 Columns Wide)\*\*: Span the full 2-column width of the left zone\[cite: 14\]. Labels use H2/H3 styling (\`Bahnschrift Bold SemiCondensed\`, uppercase, 16px, \`\#FFFFFF\`, 4px bottom margin)\[cite: 14, 15\].

  - \*\*Tier-2 Sub-Fields (1 Column Wide Each)\*\*: Sit side-by-side in a 2-column sub-grid (1 master grid column per box, separated by the 24px gutter)\[cite: 14\]. Labels use smaller uppercase tags (\`Bahnschrift Bold SemiCondensed\`, 11px, \`\#FFFFFF\`, 4px bottom margin)\[cite: 14, 15\].


\#\#\#\# 2.2 Filter Sections (Top to Bottom)

1. \*\*Section 1 — \`ORIGIN\`\*\* (16px bottom margin):

   - Primary Box (\`ORIGIN\` — City Name): 2 columns wide\[cite: 14, 15\].

   - Sub-Row (8px top margin): \`AIRPORT\` (1 column wide) and \`ICAO\` (1 column wide) side-by-side\[cite: 14, 15\].

2. \*\*Section 2 — \`DESTINATION\`\*\* (16px bottom margin):

   - Primary Box (\`DESTINATION\` — City Name): 2 columns wide\[cite: 14, 15\].

   - Sub-Row (8px top margin): \`AIRPORT\` (1 column wide) and \`ICAO\` (1 column wide) side-by-side\[cite: 14, 15\].

3. \*\*Section 3 — \`AIRPLANE\`\*\* (16px bottom margin):

   - Primary Box (\`AIRPLANE\`): 2 columns wide\[cite: 14, 15\].

4. \*\*Section 4 — \`AIRLINE\`\*\* (24px bottom margin):

   - Primary Box (\`AIRLINE\`): 2 columns wide\[cite: 14, 15\].


\#\#\#\# 2.3 Action Buttons (2 Columns Wide)

- \*\*\`SEARCH\` Button\*\*:

  - Dimensions: Full 2-column width, height 40px, 12px bottom margin\[cite: 14, 15\].

  - Styling: Standard Interactive Button (Fill \`\#2C6591\`, Text \`\#FFFFFF\` in \`Bahnschrift Bold SemiCondensed\`, uppercase, 15px, 0px border)\[cite: 8, 14, 15\].

- \*\*\`SEND TO SIMBRIEF\` Button\*\*:

  - Dimensions: Full 2-column width, height 40px\[cite: 14, 15\].

  - \*\*Default State (No Flight Selected in Table)\*\*: Positive Disabled State — Fill \`\#113B00\`, Text \`\#0A2400\`, \`pointer-events: none\`\[cite: 8, 14\].

  - \*\*Active State (Flight Row Selected in Table)\*\*: Positive Enabled State — Fill \`\#43E600\`, Text \`\#0B2600\` (\`Bahnschrift Bold\`, uppercase, 15px)\[cite: 8, 15\].


---


\#\#\# 3. Right Zone: Flight Results Table (10 Columns)


\#\#\#\# 3.1 Table Frame & Column Allocation

- \*\*Outer Container\*\*: Spans columns 3 through 12 (10 columns total)\[cite: 14\]. Framed by a 1pt solid \`\#45AFFF\` outer border\[cite: 14, 15\].

- \*\*Internal Column Proportions & Vertical Dividers\*\*:

  - \*\*Column 1 — \`Airline\`\*\*: Occupies 2 columns of width\[cite: 14\]. Ends with a full-height 1pt vertical divider line (\`\#45AFFF\` at 40% or \`\#2C6591\`) on its right edge\[cite: 14, 15\].

  - \*\*Columns 2 & 3 — \`Origin\` and \`Destination\`\*\*: Occupy the central 6 columns (3 columns each)\[cite: 14\]. \*\*CRITICAL\*\*: Do NOT render a vertical divider line between \`Origin\` and \`Destination\`\[cite: 14, 15\]. They share an open central span.

  - \*\*Column 4 — \`Plane\`\*\*: Occupies the final 2 columns of width\[cite: 14\]. Preceded by a full-height 1pt vertical divider line on its left edge\[cite: 14, 15\].


\#\#\#\# 3.2 Header & Row Styling

- \*\*Table Header\*\*:

  - Fill: \`\#002C4D\`\[cite: 8, 14\].

  - Bottom Border: 1pt solid \`\#45AFFF\`\[cite: 14, 15\].

  - Typography: \`Bahnschrift SemiCondensed\`, title case (\`Airline\`, \`Origin\`, \`Destination\`, \`Plane\`), 18px, \`\#FFFFFF\` (or \`\#DBF0FF\`), 16px horizontal cell padding\[cite: 14, 15\].

- \*\*Table Rows (Unselected)\*\*:

  - Height: 36px to 40px\[cite: 14, 15\].

  - Background: Alternating horizontal stripes between Secondary Background (\`\#002540\`) and deep base navy (\`\#001626\` / transparent)\[cite: 8, 14, 15\].

  - Text Color: \`\#DBF0FF\` (NOT pure white) in \`Bahnschrift Condensed\`, 14px\[cite: 8, 14\].

  - Route Format: Format \`Origin\` and \`Destination\` strings as \`ICAO (Full Airport Name)\`, e.g., \`RJAA (Tokyo Narita International)\`\[cite: 14, 15\].

- \*\*Selected Row State\*\*:

  - Clicking any row highlights the entire horizontal row in solid \`\#43E600\` (Positive CTA Green) with text switching to \`\#0B2600\` (\`Bahnschrift Condensed\`), and simultaneously unlocks the \`SEND TO SIMBRIEF\` button on the left panel\[cite: 15\].


