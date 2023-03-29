import contentful from "contentful-management";
import axios from "axios";
import { Logger } from "tslog";

const logger = new Logger({ name: "Contentful Data Import Script Logger" });

interface IImportDataToContentful {
  url: string;
  headers?: Record<string, any>;
  localeId: string;
  contentTypes: {
    assetLabels: IAssetLabels;
    [key: string]: any;
  };
  contentTypeId: string;
}

interface IBuildContentfulEntries {
  externalData: any[];
  contentTypes: Record<string, any>;
  contentTypeId: string;
  localeCode: string;
  contentfulClient: contentful.Environment;
}

interface IEntriesImport {
  externalData: any[];
  contentTypes: Record<string, any>;
  contentTypeId: string;
  localeCode: string;
  contentfulClient: contentful.Environment;
}

interface IAssetLabels {
  ["title"]: string;
  ["upload"]: string;
  ["contentType"]: string;
}

const contentfulStablishConnection =
  async (): Promise<contentful.Environment> => {
    logger.info("Connecting to Contentful");
    const client = contentful.createClient({
      accessToken: "CFPAT-uIIM9Oe2crOcpdYqNNV3TttpKpO9kij3Ws0whl6UHyE",
    });

    logger.info("Getting Contentful space");
    const contentfulSpace = await client.getSpace("0u8ebu7x4bew");

    logger.info("Getting Contentful environment");
    const contentfulEnvironment = await contentfulSpace.getEnvironment(
      "master"
    );

    return contentfulEnvironment;
  };

const matchDataContentTypes = (
  content: Record<string, any>[],
  contentTypes: Record<string, any>
): Record<string, any>[] => {
  logger.info(
    "Matching external data content types to Contentful content types"
  );
  const entriesObject: Record<string, any>[] = [];
  content.slice(0, 10).forEach((item) => {
    const rawEntry: Record<string, any> = {};
    for (const key in contentTypes) {
     if (key !== "assetLabels") rawEntry[contentTypes[key]] = item[key];
    }

    entriesObject.push(rawEntry);
  });

  return entriesObject;
};

const pullExternalContent = async (
  url: string,
  headers?: Record<string, any>
) => {
  logger.info("Getting external data");
  return (await axios.get(url, { headers })).data;
};

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

const processDataRequests = async (
  dataToImportPromises: Promise<any>[]
): Promise<PromiseSettledResult<any>[]> => {
  logger.info("Importing new contentful data");

  return await Promise.allSettled(dataToImportPromises);
};

const buildContentfulEntriesPromises = async ({
  externalData,
  contentTypes,
  contentTypeId,
  localeCode,
  contentfulClient,
}: IBuildContentfulEntries) => {
  const contentfulNewEntriesObject = matchDataContentTypes(
    externalData,
    contentTypes
  );
    
  logger.info("Building Contentful new entries object to be imported");
  const createEntriesPromises: Promise<any>[] = [];
  contentfulNewEntriesObject.forEach((rawEntry) => {
    let fields: Record<string, any> = {};

    for (const key in rawEntry) {
      if (key !== "image")
        fields[key] = {
          [localeCode]: rawEntry[key].toString(),
        };
    }
    
    
    
    createEntriesPromises.push(
      contentfulClient
        .createEntry(contentTypeId, { fields })
        .then((entry) => {
          
          const imageUrl = rawEntry[contentTypes.assetLabels.upload];
          const fileName = `${entry.sys.id}.jpg`;
          
          let newAssetObject = {
            title: {
              [localeCode]: fileName,
            },
            file: {
              [localeCode]: {
                contentType: contentTypes.assetLabels.contentType,
                fileName,
                upload: imageUrl,
              },
            },
          };
          contentfulClient
            .createAsset({ fields: { ...newAssetObject } })
            .then((asset) => asset.processForAllLocales()).then(asset=> asset.publish())
            .then((asset) => {

              entry.fields[contentTypes.assetLabels.contentType] = {
                [localeCode]: entry.fields[contentTypes.assetLabels.contentType]?.localeCode
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
              entry.update().then(entry => entry.publish());
            });
        })
    );
  });

  return createEntriesPromises;
};

const importEntriesToContentful = async ({
  externalData,
  localeCode,
  contentTypes,
  contentTypeId,
  contentfulClient,
}: IEntriesImport) => {
  const createEntriesBulkPromises = await buildContentfulEntriesPromises({
    externalData,
    contentTypes,
    contentTypeId,
    localeCode,
    contentfulClient,
  });

  const entriesImportingResults = await processDataRequests(
    createEntriesBulkPromises
  );

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

const importDataToContentfulFlow = async ({
  url,
  contentTypes,
  contentTypeId,
  localeId,
  headers,
}: IImportDataToContentful): Promise<void> => {
  try {
    const contentfulClient = await contentfulStablishConnection();

    const localeCode = await validateAndRetrieveResources(
      contentTypeId,
      localeId,
      contentfulClient
    );

    const externalData: [] = (await pullExternalContent(url, headers)).data;

    await importEntriesToContentful({
      externalData,
      localeCode,
      contentTypes,
      contentTypeId,
      contentfulClient,
    });

    // await importAssetsToContentful({
    //     externalData,
    //     contentTypes.assetLabels,
    //     localeCode,
    //     contentfulClient,
    //   })
  } catch (error: any) {
    const parsedError = error.message ? JSON.parse(error?.message) : error;
    const parameters = {
      url,
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
  url: "https://dummyapi.io/data/v1/post",
  headers: {
    "app-id": "6423116cd3cbd49cd60cc1bf",
  },
  contentTypes: {
    id: "title",
    text: "postBody",
    likes: "postAuthor",
    image: "image",
    assetLabels: {
      title: "id",
      upload: "image",
      contentType: "image",
    },
  },
  contentTypeId: "blogPost",
  localeId: "5rybbKSGp3JC1AKfSziJ7z", //en-US is the default locale
});
