import contentful from "contentful-management";
import axios from "axios";
import { readFileSync } from "fs";
import * as path from "path";
import { Logger } from "tslog";
import * as dotenv from 'dotenv'
dotenv.config()

const logger = new Logger({ name: "Contentful Data Import Script Logger" });

//Main interface for the whole import process. Used in importDataToContentfulFlow function
interface IImportDataToContentfulFlow {
  externalSource: {
    url?: string;
    localFilePath?: string;
  };
  contentfulConnectionCredentials: IContentfulConnection;
  contentfulLocaleId: string;
  contentTypesToMatch: {
    assetsKeysToMatch: IAssetLabels;
    [contentfulContentTypeKey: string]: any;
  };
  contentfulContentTypeId: string;
}

//Used in BuildContentfulEntriesPromises function.
interface IBuildContentfulEntriesPromises {
  contentfulNewEntriesObject: Record<string, any>[];
  contentTypes: Record<string, any>;
  contentTypeId: string;
  localeCode: string;
  contentfulClient: contentful.Environment;
}

//Used in importEntriesToContentful function.
interface IImportEntriesToContentful {
  externalData: any[];
  contentTypes: Record<string, any>;
  contentTypeId: string;
  localeCode: string;
  contentfulClient: contentful.Environment;
}

//Used in IImportDataToContentfulFlow interface.
interface IAssetLabels {
  ["title"]: string;
  ["upload"]: string;
  ["contentType"]: string;
}

//Used in contentfulStablishConnection function and IImportDataToContentfulFlow interface
interface IContentfulConnection {
  headers?: Record<string, any>;
  accesToken: string;
  contentfulSpace: string;
  contentfulEnvironment?: string;
}

/*
It creates and returns the Contentful connection object.
*/
const contentfulStablishConnection = async (
  contentfulConnectionCredentials: IContentfulConnection
): Promise<contentful.Environment> => {
  logger.info("Connecting to Contentful");
  const contentfulClient = contentful.createClient({
    accessToken: contentfulConnectionCredentials.accesToken,
  });

  logger.info("Getting Contentful space");
  const contentfulSpace = await contentfulClient.getSpace(
    contentfulConnectionCredentials.contentfulSpace
  );

  logger.info("Getting Contentful environment");
  return await contentfulSpace.getEnvironment(
    contentfulConnectionCredentials.contentfulEnvironment ?? "master"
  );
};

/*
It validates the Contentful content type id and locale id exists in the Contentful environment. 
It also retrieves and returns the locale code from Contentful if locale id exists.
*/
const validateAndRetrieveResources = async (
  contentTypeId: string,
  localeId: string,
  contentfulClient: contentful.Environment
): Promise<string> => {
  logger.info(
    "Validating if given locale id exists in Contentful environment and retrieving locale code",
    { localeId }
  );
  const localeCode = (await contentfulClient.getLocale(localeId)).code;

  logger.info(
    "Validating if given content type id exists in Contentful environment",
    { contentTypeId }
  );
  await contentfulClient.getContentType(contentTypeId);

  return localeCode;
};

/*
It gets and returns the external data either if it comes from an endpoint
*/
const getExternalContentFromUrl = async (
  url: string,
  headers?: Record<string, any>
) => {
  logger.info("Getting external data");
  return (await axios.get(url, { headers })).data;
};

/*
It gets and returns the external data either if it comes from an endpoint
*/
const getExternalContentFromFile = async (localFilePath: string) => {
  const configDirectory = path.resolve(process.cwd(), "config");

  logger.info("Getting external data");
  const data = readFileSync(path.join(configDirectory, localFilePath), "utf8");

  return JSON.parse(data);
};

/*
It stablishes a match between the Contentful content types and the external content types.
It returns the resultant object that contains the Contentful content types as key and the corresponding 
external data as value.
*/
const matchDataContentTypes = (
  content: Record<string, any>[],
  contentTypes: Record<string, any>
): Record<string, any>[] => {
  logger.info(
    "Matching external data content types to Contentful content types"
  );
  const entriesObject: Record<string, any>[] = [];
  content.forEach((item) => {
    const rawEntry: Record<string, any> = {};
    for (const key in contentTypes) {
      if (key !== "assetsKeysToMatch") {
        rawEntry[key] = {
          value: item[contentTypes[key]["externalKey"]],
          type: contentTypes[key].type,
        };
      }
    }
    entriesObject.push(rawEntry);
  });

  return entriesObject;
};

/*
It makes every 'create Contentful entry' request, 'create Contentful asset' request and 'update 
Contentful entry' request with the relationship between an asset and an entry.
It also make the 'publish' request for every resource.
Finally it returns the array of Promises
*/
const buildContentfulEntriesPromises = ({
  contentfulNewEntriesObject,
  contentTypes,
  contentTypeId,
  localeCode,
  contentfulClient,
}: IBuildContentfulEntriesPromises) => {
  logger.info("Building Contentful new entries object to be imported");
  const createEntriesPromises: Promise<any>[] = [];

  contentfulNewEntriesObject.forEach((rawEntry) => {
    let fields: Record<string, any> = {};

    for (const key in rawEntry) {
      if (key !== contentTypes.assetsKeysToMatch?.contentType) {
        const entryValue = rawEntry[key].value.toString();
        fields[key] = {
          [localeCode]:
            rawEntry[key].type !== "RichText"
              ? entryValue
              : {
                  content: [
                    {
                      nodeType: "paragraph",
                      data: {},
                      content: [
                        {
                          value: entryValue,
                          nodeType: "text",
                          marks: [],
                          data: {},
                        },
                      ],
                    },
                  ],
                  data: {},
                  nodeType: "document",
                },
        };
      }
    }

    createEntriesPromises.push(
      contentfulClient.createEntry(contentTypeId, { fields }).then((entry) => {
        const fileName = `${entry.sys.id}.jpg`;

        let newAssetObject = {
          title: {
            [localeCode]: fileName,
          },
          file: {
            [localeCode]: {
              contentType: contentTypes.assetsKeysToMatch.contentType,
              fileName,
              upload: rawEntry[contentTypes.assetsKeysToMatch.upload]["value"],
            },
          },
        };
        contentfulClient
          .createAsset({ fields: { ...newAssetObject } })
          .then((asset) => asset.processForAllLocales())
          .then((asset) => asset.publish())
          .then((asset) => {
            entry.fields[contentTypes.assetsKeysToMatch.contentType] = {
              [localeCode]: entry.fields[
                contentTypes.assetsKeysToMatch.contentType
              ]?.localeCode
                ? [
                    ...entry.fields[contentTypes.image][localeCode],
                    {
                      sys: {
                        type: "Link",
                        linkType: "Asset",
                        id: asset.sys.id.toString(),
                      },
                    },
                  ]
                : [
                    {
                      sys: {
                        type: "Link",
                        linkType: "Asset",
                        id: asset.sys.id.toString(),
                      },
                    },
                  ],
            };
            entry.update().then((entry) => entry.publish());
          });
      })
    );
  });

  return createEntriesPromises;
};

/* 
It receives and array of Promises to be resolved using Promise.allSettled() function
Finally it returns an array of elements that represent the result of every resolved promise
*/
const processPromisesRequests = async (
  dataToImportPromises: Promise<any>[]
): Promise<PromiseSettledResult<any>[]> => {
  logger.info("Importing data");

  return await Promise.allSettled(dataToImportPromises);
};

/*
It gathers information about the importing process and shows it 
in the logs
*/
const generateImportingResults = async (
  entriesImportingResults: PromiseSettledResult<any>[]
) => {
  let rejectedEntriesImports: any[] = [];
  entriesImportingResults.forEach((entry) => {
    if (entry.status === "rejected") {
      const errorObject = JSON.parse(entry?.reason?.message);
      rejectedEntriesImports.push({
        errorStatus: errorObject?.status, // If error status code is 409. From https://www.contentful.com/developers/docs/references/errors/  -> This error occurs when you're trying to update an existing asset, entry or content type, and you didn't specify the current version of the object or specified an outdated version.
        errorMessage: errorObject?.statusText,
        message: errorObject?.message,
        details: errorObject?.details,
        payloadSent: errorObject?.request?.url, //With the url we can know which entry id fails to be imported
      });
    }
  });

  logger.info(
    `Job Completed: Entries import. Sucessfully:  ${
      entriesImportingResults.length - rejectedEntriesImports.length
    }. Failed: ${rejectedEntriesImports.length}. `,
    rejectedEntriesImports.length > 0
      ? {
          rejectedImports: rejectedEntriesImports,
        }
      : "No errors found"
  );
};

/*
Main function that triggers the import data flow
*/
const importDataToContentfulFlow = async ({
  externalSource,
  contentTypesToMatch: contentTypes,
  contentfulContentTypeId: contentTypeId,
  contentfulLocaleId: localeId,
  contentfulConnectionCredentials,
}: IImportDataToContentfulFlow): Promise<void> => {
  try {
    const contentfulClient = await contentfulStablishConnection(
      contentfulConnectionCredentials
    );

    const localeCode = await validateAndRetrieveResources(
      contentTypeId,
      localeId,
      contentfulClient
    );

    let externalData: [];
    if (externalSource.url) {
      externalData = (
        await getExternalContentFromUrl(
          externalSource.url!,
          contentfulConnectionCredentials?.headers
        )
      ).data;
    } else {
      externalData = (await getExternalContentFromFile(
        externalSource.localFilePath!
      )).data;
    }

    const contentfulNewEntriesObject = matchDataContentTypes(
      externalData,
      contentTypes
    );

    const createEntriesPromises = buildContentfulEntriesPromises({
      contentfulNewEntriesObject,
      contentTypes,
      contentTypeId,
      localeCode,
      contentfulClient,
    });

    const entriesImportingResults = await processPromisesRequests(
      createEntriesPromises
    );

    generateImportingResults(entriesImportingResults);
  } catch (error: any) {
    const parsedError =
      error.message && error.details ? JSON.parse(error?.message) : error;
    const parameters = {
      externalSource,
      contentTypes,
      contentTypeId,
      localeId,
    };
    logger.error(
      `There was an error when trying to import data`,
      parsedError.details
        ? {
            errorStatus: parsedError.status,
            errorMesage: parsedError.message,
            errorDetails: parsedError.details,
            request: parsedError.request,
            parameters,
          }
        : { ...parsedError, parameters }
    );
  }
};

await importDataToContentfulFlow({
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
});
