# Internal Users Toggle Button

Replaced the "Show Internal" checkbox with a toggle button.

## Behavior
- **Default (hidden):** Button shows `🚫 Show Internal` (inactive style)
- **Active (showing):** Button shows `👁️ Hide Internal` (active style with purple highlight)
- Click toggles `showInternal` state, persists to localStorage, refreshes dashboard
- Uses same `view-btn` / `view-btn active` classes as the Organization/User view buttons
