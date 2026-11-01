import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Deep teal: calm, financial, and readable as white-on-brand at shade 8 (light) / 6 (dark). */
const brand: MantineColorsTuple = ['#e3faf6', '#c9efe8', '#97ddd0', '#62cab7', '#38b9a2', '#1fae95', '#0ea28a', '#008d77', '#007d69', '#006b59'];

/** Cool blue-grey dark surfaces instead of Mantine's neutral greys. */
const dark: MantineColorsTuple = ['#c9ccd4', '#b4b8c2', '#8a8f9c', '#6b7080', '#474c5a', '#363a46', '#2a2e38', '#1f222b', '#181a22', '#12141a'];

const FONT = "'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', sans-serif";
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 8, dark: 6 },
  colors: { brand, dark },
  fontFamily: FONT,
  headings: { fontFamily: FONT, fontWeight: '600' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  respectReducedMotion: true,
  focusRing: 'auto',
  shadows: {
    xs: '0 1px 2px rgba(16, 24, 40, 0.05)',
    sm: '0 1px 3px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.04)',
    md: '0 6px 16px -4px rgba(16, 24, 40, 0.10), 0 2px 4px -2px rgba(16, 24, 40, 0.06)',
    lg: '0 16px 32px -8px rgba(16, 24, 40, 0.14)',
    xl: '0 24px 48px -12px rgba(16, 24, 40, 0.20)',
  },
  other: { ease: EASE },
  components: {
    Button: { defaultProps: { radius: 'md' } },
    ActionIcon: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { radius: 'lg', withBorder: true, shadow: 'xs' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Badge: { defaultProps: { radius: 'sm', fw: 600 } },
    TextInput: { defaultProps: { size: 'sm' } },
    PasswordInput: { defaultProps: { size: 'sm' } },
    NumberInput: { defaultProps: { size: 'sm' } },
    Select: {
      defaultProps: { size: 'sm', comboboxProps: { withinPortal: true, shadow: 'md', transitionProps: { transition: 'pop', duration: 140 } } },
    },
    MultiSelect: { defaultProps: { comboboxProps: { shadow: 'md', transitionProps: { transition: 'pop', duration: 140 } } } },
    Table: { defaultProps: { verticalSpacing: 8, horizontalSpacing: 'md' } },
    Modal: {
      defaultProps: {
        radius: 'lg',
        centered: true,
        overlayProps: { backgroundOpacity: 0.4, blur: 3 },
        transitionProps: { transition: 'pop', duration: 200, timingFunction: EASE },
      },
    },
    Drawer: { defaultProps: { overlayProps: { backgroundOpacity: 0.35, blur: 2 }, transitionProps: { duration: 240, timingFunction: EASE } } },
    Menu: { defaultProps: { radius: 'md', shadow: 'md', transitionProps: { transition: 'pop', duration: 150 } } },
    Popover: { defaultProps: { radius: 'md', shadow: 'md', transitionProps: { transition: 'pop', duration: 150 } } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 250, transitionProps: { transition: 'fade', duration: 120 } } },
    Notification: { defaultProps: { radius: 'md', withBorder: true } },
    NavLink: { defaultProps: { variant: 'light' } },
    SegmentedControl: { defaultProps: { radius: 'md' } },
  },
});
