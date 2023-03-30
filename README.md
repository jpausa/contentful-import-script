# contentful-import-script Instructions

1. You can install `ts-node` in order to run the script directly
2. Set up the `.env` file with the required data
3. At the end of the script file there is a call to the function `importDataToContentfulFlow` which triggers the import flow.
4. You need to fill the parameters with the right data before you run the script.
5. Execute `ts-node --esm src/script.ts`

# `importDataToContentfulFlow` function parameters

```typescript
{
  externalSource: {
    //url: process.env.EXTERNAL_SOURCE!,
    localFilePath: process.env.EXTERNAL_SOURCE!,
  },
  contentfulConnectionCredentials: {
    accesToken: process.env.CONTENTFUL_ACCESS_TOKEN!,
    contentfulSpace: process.env.CONTENTFUL_SPACE_ID!,
    contentfulEnvironment: process.env.CONTENTFUL_ENVIRONMENT_ID!
  },
  contentTypesToMatch: {
    title: { type: "Symbol", externalKey: "id" },
    postBody: { type: "Symbol", externalKey: "text" },
    postAuthor: { type: "Symbol", externalKey: "likes" },
    image: { type: "image", externalKey: "image" },
    assetsKeysToMatch: {
      title: "id",
      upload: "image",
      contentType: "image",
    },
  },
  contentfulContentTypeId: process.env.CONTENTFUL_CONTENT_TYPE_ID!,
  contentfulLocaleId: process.env.CONTENTFUL_LOCALE_ID!, //en-US is the default locale
}
```

### `contentTypesToMatch` Object properties

This object is used to make a match between Contentful content types and the external data content types.

Each `key` at the top level represents the field id in Contentful. Its values consist in an object whith the following keys:

- `type`: The field type in Contentful
- `externalKey`: the field name in the external data

In the example above the first key `title` is the `field id` in Contentful in wich we want to make the import from it corresponding field in the external data object. Also it contains an object with `type` and `externalKey` keys. In this case, `type` will be the field data type defined in Contentful, i.e: `Symbol`, `Text`, `RichText`, etc. The `externalKey` will be the key in the external data object from which we want to match it value from.
