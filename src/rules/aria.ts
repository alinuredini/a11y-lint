// ARIA 1.2 (+ 1.3 drafts in browsers) attribute and role vocabularies.

export const ARIA_ATTRS = new Set(
  `activedescendant atomic autocomplete braillelabel brailleroledescription busy checked colcount colindex
  colindextext colspan controls current describedby description details disabled dropeffect errormessage expanded
  flowto grabbed haspopup hidden invalid keyshortcuts label labelledby level live modal multiline multiselectable
  orientation owns placeholder posinset pressed readonly relevant required roledescription rowcount rowindex
  rowindextext rowspan selected setsize sort valuemax valuemin valuenow valuetext`
    .split(/\s+/)
    .map((a) => `aria-${a}`),
);

export const ROLES = new Set(
  `alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox
  comment complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic
  grid gridcell group heading img image insertion link list listbox listitem log main mark marquee math menu menubar
  menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio
  radiogroup region row rowgroup rowheader scrollbar search searchbox sectionfooter sectionheader separator slider
  spinbutton status strong subscript suggestion superscript switch tab table tablist tabpanel term textbox time timer
  toolbar tooltip tree treegrid treeitem`.split(/\s+/),
);

export function isValidRole(role: string): boolean {
  return ROLES.has(role) || /^doc-[a-z]+$/.test(role) || /^graphics-(document|object|symbol)$/.test(role);
}

/** Widget roles a keyboard user must be able to reach and operate. */
export const INTERACTIVE_ROLES = new Set(
  `button checkbox combobox gridcell link menuitem menuitemcheckbox menuitemradio option radio scrollbar searchbox
  slider spinbutton switch tab textbox treeitem`.split(/\s+/),
);

/** Roles whose accessible name must come from author attributes, not content. */
export const NAME_FROM_AUTHOR_ROLES = new Set(
  `alertdialog combobox dialog grid img listbox meter progressbar radiogroup searchbox slider spinbutton
  textbox tree treegrid`.split(/\s+/),
);

/** States a custom widget must expose (ARIA 1.2 required states and properties). */
export const REQUIRED_ARIA: Record<string, string[]> = {
  checkbox: ['aria-checked'],
  combobox: ['aria-expanded'],
  heading: ['aria-level'],
  menuitemcheckbox: ['aria-checked'],
  menuitemradio: ['aria-checked'],
  radio: ['aria-checked'],
  scrollbar: ['aria-controls', 'aria-valuenow'],
  slider: ['aria-valuenow'],
  switch: ['aria-checked'],
};

export const AUTOCOMPLETE_TOKENS = new Set(
  `on off name honorific-prefix given-name additional-name family-name honorific-suffix nickname email username
  new-password current-password one-time-code organization-title organization street-address address-line1
  address-line2 address-line3 address-level4 address-level3 address-level2 address-level1 country country-name
  postal-code cc-name cc-given-name cc-additional-name cc-family-name cc-number cc-exp cc-exp-month cc-exp-year
  cc-csc cc-type transaction-currency transaction-amount language bday bday-day bday-month bday-year sex url photo
  tel tel-country-code tel-national tel-area-code tel-local tel-local-prefix tel-local-suffix tel-extension impp
  webauthn`.split(/\s+/),
);

export const AUTOCOMPLETE_MODIFIERS = /^(section-\S+|shipping|billing|home|work|mobile|fax|pager)$/;
