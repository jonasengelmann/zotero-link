# Zotero Link

This fork of [Zotero Link](https://github.com/vanakat/zotero-link) generates links in the same format Zotero uses when you paste copied annotations as plain text:

`([Author, Year, p. 67](zotero://select/library/items/ITEM_KEY)) ([pdf](zotero://open-pdf/library/items/PDF_ID?page=12))`

The page number in the first link corresponds to the PDF's page label, while the second corresponds to the actual page number.

## Prerequisites

### Zotero >= 7

Enable Local API feature in settings: `Settings > Advanced > Allow other applications on this computer to communicate with Zotero`

## Installation

Install [zotero-bridge-fork](https://github.com/jonasengelmann/zotero-bridge)

## Commands

- Insert Zotero Item: Search Zotero library and insert citation link
- Insert Zotero Item PDF Page / Range: Search Zotero library and insert link with page or page range information. Enter page labels, they will be automatically resolved to the actual page numbers for the PDF link.

Both commands also work for items without PDF attachments. It does not yet support multiple PDF attachments per one Zotero item.

## Development

Fork and clone this repository
Link this directory to your plugins directory: ln -sfn zotero-link-dev <your-test-vault>/.obsidian/plugins/obsidian-zotero
npm install to install all dependencies
npm run dev will run development server
Reload your Obsidian

## License

MIT
