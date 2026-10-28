import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'indigo',
  fontFamily: "'IBM Plex Sans Arabic', system-ui, sans-serif",
  headings: { fontFamily: "'IBM Plex Sans Arabic', system-ui, sans-serif" },
  defaultRadius: 'sm',
  components: {
    TextInput: { defaultProps: { size: 'sm' } },
    Select: { defaultProps: { size: 'sm', comboboxProps: { withinPortal: true } } },
    Table: { defaultProps: { verticalSpacing: 6, horizontalSpacing: 'sm' } },
  },
});
