// AhaSlides ant-design-vue theme — the design-token set that gives every
// `<a-button>` / `<a-input>` / `<a-select>` / `<a-tag>` the AhaSlides
// storybook look without hand-building bespoke components. Feed this object
// to `<a-config-provider :theme="ahaSlidesDefaultTheme">` (see App.vue).
//
// Tokens mirror the AhaSlides brand-colour spec (Violet Purple #6A1EBB
// primary, Radical Pink #FF4081, etc.) and the modern presenter storybook
// primitives (AntdButton.vue / Input.vue / Textarea.vue), which are
// themselves ant-design-vue components wrapped with a token theme — so
// theming Ant here is the faithful way to match them.

import { theme as antTheme } from 'ant-design-vue'

const SeedTokens = {
  fontSize: 14,
  fontFamily: 'Plus Jakarta Sans, sans-serif',
  borderRadius: 8, // storybook md/lg button + input radius
  colorBgBase: '#FFFFFF',
  colorPrimary: '#6A1EBB', // Violet Purple — primary CTA / primary button fill
  colorPrimaryHover: '#8644D4', // storybook primary button hover (purple-50)
  colorPrimaryActive: '#5715A0', // storybook primary button active (purple-80)
  colorError: '#F5222D', // storybook danger button fill
  colorErrorHover: '#FF4D4F', // storybook danger button hover
  colorErrorActive: '#CF1322', // storybook danger button active
  colorSuccess: '#16C49A',
  colorWarning: '#FF7747',
  colorInfo: '#9BB3E9',
  colorTextBase: '#1A1A1A',
  colorBorder: '#E3E3E3', // storybook secondary (default) button border (gray-40)
  // Divider / section hairline pinned to the brand's Muted Indigo Gray at 12%,
  // overriding Ant's off-brand near-black default.
  colorSplit: 'rgba(62, 62, 90, 0.12)',
  colorTextPlaceholder: '#999999', // storybook input placeholder (base-70)
  colorBgContainerDisabled: '#E3E3E3', // storybook disabled button bg
  colorTextDisabled: '#B5B5B5', // storybook disabled button text
}

const MapTokens = {
  borderRadiusSM: 4, // storybook small button radius
  borderRadiusLG: 8, // storybook large button radius
  borderRadiusXL: 12,
  // Ant's standard easing already matches the storybook button curve;
  // motionDurationSlow pins it at 0.3s.
  motionDurationSlow: '0.3s',
}

const AliasTokens = {
  borderWidth: '1px',
  borderStyle: 'solid',
  buttonHeightXL: 48,
  buttonPaddingHorizontalXL: 20,
  colorBgBaseDark: '#1A1A2E1A',
  colorBgFillDisabled: '#E3E3E3',
  colorTextDisabled: '#B5B5B5',
  baseSpacing: '16px',
}

export const ahaSlidesDefaultTheme = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    ...SeedTokens,
    ...MapTokens,
    ...AliasTokens,
  },
  components: {
    Button: {
      // Storybook AntdButton.vue uses font-weight 600 on solid variants.
      fontWeight: 600,
      // Per-size heights from the storybook spec (sm/md/lg = 28/36/40).
      controlHeightSM: 28,
      controlHeight: 36,
      controlHeightLG: 40,
      // Flat 8px corner on every size to match the presenter button.
      borderRadius: 8,
      borderRadiusLG: 8,
      borderRadiusSM: 4,
    },
    Input: {
      controlHeight: 40, // storybook Input.vue height
      controlHeightSM: 32, // storybook small input
      activeBorderColor: '#6A1EBB', // storybook input hover/focus border
      hoverBorderColor: '#6A1EBB',
      // Flatter 4px corner than the button (matches the presenter input).
      borderRadius: 4,
      borderRadiusLG: 4,
      borderRadiusSM: 4,
    },
    InputNumber: {
      controlHeight: 40,
      activeBorderColor: '#6A1EBB',
      hoverBorderColor: '#6A1EBB',
      borderRadius: 4,
      borderRadiusLG: 4,
      borderRadiusSM: 4,
    },
    Select: {
      // Pin to 40px so Select matches the input family by default.
      controlHeight: 40,
      controlHeightLG: 40,
      borderRadius: 4,
    },
    Divider: {
      // Brand Muted Indigo Gray hairline, matching colorSplit above.
      colorSplit: 'rgba(62, 62, 90, 0.12)',
    },
  },
}
