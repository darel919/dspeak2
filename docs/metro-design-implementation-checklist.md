# Metro design implementation checklist

This checklist tracks the application-wide adoption of
`.codex/metro-design-language.md`. A checked item means the implementation is
present in the repository. Browser-only checks remain open until they have been
verified on the listed devices and input modes.

## Foundation

- [x] Use Segoe UI, Helvetica Neue, Arial, and sans-serif for application UI.
- [x] Use a shared 4 px spacing scale and Metro page, pane, toolbar, flyout, and
      status primitives.
- [x] Apply one active room or user accent to primary actions, selection, focus,
      progress, and links.
- [x] Preserve semantic success, caution, error, and information colors.
- [x] Use square corners for application surfaces and controls while retaining
      circular avatars and status indicators.
- [x] Remove ornamental gradients, glass effects, broad shadows, and decorative
      card styling from primary application surfaces.
- [x] Keep elevation limited to real overlays such as dialogs, menus, and
      flyouts.
- [x] Provide shared focus-visible, disabled, loading, selection, and error
      treatments.
- [x] Use the shared Metro transition and respect reduced-motion preferences.
- [x] Add forced-colors support for focus, selection, boundaries, and controls.

## Application shell and navigation

- [x] Use a fixed desktop room rail with a clear selected room.
- [x] Keep the current room or page title visible in the primary navigation.
- [x] Keep frequent room, channel, search, notification, and account actions
      directly available.
- [x] Use Lucide icons with accessible names or adjacent text.
- [x] Reflow navigation deliberately for narrow screens.
- [x] Keep room and channel menus anchored to their source and dismissible with
      Escape or outside activation.
- [x] Give touch-facing navigation controls at least a 44 by 44 px target.

## Room, channel, chat, and member surfaces

- [x] Make chat content visually dominant over surrounding navigation chrome.
- [x] Use flat, aligned channel and member rows with explicit hover, selected,
      focus, and activity states.
- [x] Preserve circular user avatars and small circular presence indicators.
- [x] Keep message actions close to the message and available without relying on
      a hidden gesture.
- [x] Keep loading, empty, offline, reconnecting, and error states in context.
- [x] Use specific labels for message edit, delete, retry, and navigation
      actions.
- [x] Keep blocking confirmation for destructive message deletion.

## Voice, video, and soundboards

- [x] Use a dark, content-led media canvas without decorative gradients or
      glass effects.
- [x] Keep microphone, camera, screen, soundboard, and leave actions visible
      with explicit state.
- [x] Keep media controls square, comfortably sized, and keyboard focusable.
- [x] Keep participant state visible through text, icons, and shape rather than
      color alone.
- [x] Use flat participant tiles while preserving circular avatars.
- [x] Keep media settings and soundboard work in anchored flyouts or purposeful
      dialogs.

## Settings, account, room administration, and forms

- [x] Use large light-weight page titles and sentence-case section headings.
- [x] Group settings with whitespace and alignment before borders or background
      changes.
- [x] Keep labels visible and use semantic inputs, selects, checkboxes, toggles,
      sliders, and buttons.
- [x] Persist safe reversible settings immediately and show their current state.
- [x] Keep room role and accent changes immediate with explicit failure
      feedback.
- [x] Name destructive actions and their target in confirmation flows.
- [x] Keep validation and recoverable errors near their source.
- [x] Keep primary form actions visually distinct from secondary actions.

## Feedback, startup, and continuity

- [x] Use inline or page-level status for recoverable conditions.
- [x] Reserve toasts for brief outcomes rather than essential instructions or
      errors.
- [x] Keep startup visually continuous with the application and expose its
      current initialization state.
- [x] Avoid progress indicators for immediate work and place delayed progress
      near the initiating control or result.
- [x] Keep PWA, notification, database, and fatal-error prompts actionable and
      stylistically consistent.

## Responsive, accessibility, and internationalization

- [x] Preserve semantic HTML, logical focus order, accessible names, and
      keyboard-operable controls.
- [x] Do not make hover, long press, swipe, or right click the only route to an
      essential action.
- [x] Allow labels and user-authored Unicode content to wrap without breaking
      the layout.
- [x] Use locale-aware date and time formatting in application utilities.
- [x] Preserve meaningful content and actions at narrow widths and enlarged
      text sizes.
- [x] Keep structural layout free of absolute positioning where normal grid or
      flex layout applies.
- [ ] Verify complete keyboard-only navigation in current Chromium, Firefox,
      and Safari.
- [ ] Verify touch interaction and on-screen keyboard behavior on iOS Safari
      and Android Chromium.
- [ ] Verify light and dark themes at WCAG AA contrast with the supported accent
      palette.
- [ ] Verify 200% browser zoom and operating-system text enlargement.
- [ ] Verify Windows forced-colors mode.
- [ ] Verify right-to-left layout and representative translated text expansion.
- [ ] Verify reduced-motion behavior in a real browser.

## Release gates

- [x] Run `bun run format`.
- [x] Run `bun run format:check`.
- [x] Run `bun run test`.
- [x] Run `bun run build`.
- [x] Review the authenticated channel editor at 1440 by 1019 in Chromium and
      verify its bounded dialog, scrolling content, aligned media-policy rows,
      circular avatars, and persistent command bar.
- [x] Review account and voice settings in authenticated Chromium at 1440 by 1019.
- [x] Review voice settings reflow in authenticated Chromium at 390 by 844.
- [x] Review authenticated room identity, roles, role creation, and soundboard
      administration in Chromium at 1440 by 1019.
- [x] Review authenticated room navigation, text chat, member presence, and the
      disconnected voice state in Chromium at 1440 by 1019 and 390 by 844.
- [ ] Complete authenticated multi-browser visual review for room navigation,
      text chat, voice, video, screen sharing, room settings, and account
      settings.
