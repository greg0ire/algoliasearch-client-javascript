import { RequestOptions } from '@algolia/transporter-types';
import { SearchIndex } from '../../SearchIndex';
import { Method } from '@algolia/requester-types';
import { ConstructorOf } from '@algolia/support';
import { BrowsablePromise } from '../../BrowsablePromise';
import { SearchOptions } from '../types/SearchOptions';
import { BrowseOptions } from '../types/BrowseOptions';
import { BrowseResponse } from '../types/BrowseResponse';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const browseObjects = <TSearchIndex extends ConstructorOf<SearchIndex>>(
  base: TSearchIndex
) => {
  return class extends base implements HasBrowseObjects {
    public browseObjects<TObject extends object>(
      requestOptions?: SearchOptions & BrowseOptions<TObject> & RequestOptions
    ): Readonly<BrowsablePromise<TObject>> {
      return BrowsablePromise.from<TObject>({
        ...requestOptions,
        shouldStop: response => response.cursor === undefined,
        request: (data: object): Promise<BrowseResponse<TObject>> =>
          this.transporter.read(
            {
              method: Method.Post,
              path: `1/indexes/${this.indexName}/browse`,
              data,
            },
            requestOptions
          ),
      });
    }
  };
};

export type HasBrowseObjects = {
  readonly browseObjects: <TObject extends object>(
    requestOptions?: SearchOptions & BrowseOptions<TObject> & RequestOptions
  ) => Readonly<BrowsablePromise<TObject>>;
};