import {
  createRetryError,
  deserializeFailure,
  deserializeSuccess,
  HostStatusEnum,
  MappedRequestOptions,
  Request,
  serializeData,
  serializeUrl,
  StackFrame,
  StatelessHost,
  Transporter,
} from '..';
import { createStatefulHost } from '../createStatefulHost';
import { createRetryableOptions } from './createRetryableOptions';
import { Outcomes, retryDecision } from './retryDecision';

export function retryableRequest<TResponse>(
  transporter: Transporter,
  statelessHosts: readonly StatelessHost[],
  request: Request,
  requestOptions: MappedRequestOptions
): Readonly<Promise<TResponse>> {
  const stackTrace: StackFrame[] = []; // eslint-disable-line functional/prefer-readonly-type

  /**
   * First we prepare the payload that do not depend from hosts.
   */
  const data = serializeData(request, requestOptions);
  const headers = { ...transporter.headers, ...requestOptions.headers };
  const method = request.method;
  const queryParameters = {
    ...transporter.queryParameters,
    ...requestOptions.queryParameters,
    'x-algolia-agent': transporter.userAgent.value,
  };

  let timeoutsCount = 0; // eslint-disable-line functional/no-let

  const retry = (
    hosts: StatelessHost[], // eslint-disable-line functional/prefer-readonly-type
    getTimeout: (timeoutsCount: number, timeout: number) => number
  ): Readonly<Promise<TResponse>> => {
    /**
     * We iterate on each host, until there is no host left.
     */
    const host = hosts.pop(); // eslint-disable-line functional/immutable-data
    if (host === undefined) {
      throw createRetryError(stackTrace);
    }

    const payload = {
      data,
      headers,
      method,
      url: serializeUrl(host, request.path, queryParameters),
      connectTimeout: getTimeout(timeoutsCount, transporter.timeouts.connect),
      responseTimeout: getTimeout(timeoutsCount, requestOptions.timeout as number),
    };

    const decisions: Outcomes<TResponse> = {
      onSucess: response => deserializeSuccess(response),
      onRetry(response) {
        const stackFrame: StackFrame = {
          request: payload,
          response,
          host,
          triesLeft: hosts.length,
        };

        /**
         * The stackFrace is pushed to the stackTrace so we
         * can have information about the failures once a
         * retry error is thrown.
         */
        stackTrace.push(stackFrame); // eslint-disable-line functional/immutable-data

        /**
         * If response is a timeout, we increaset the number of
         * timeouts so we can increase the timeout later.
         */
        if (response.isTimedOut) {
          timeoutsCount++;
        }

        return Promise.all([
          /**
           * Failures are individually send the logger, allowing
           * the end user to debug / store stack frames even
           * when a retry error does not happen.
           */
          transporter.logger.debug('Retryable failure', stackFrame),

          /**
           * We also store the state of the host in failure cases. If the host, is
           * down it will remain down for the next 2 minutes. In a timeout situation,
           * this host will be added end of the list of hosts on the next request.
           */
          transporter.hostsCache.set(
            host,
            createStatefulHost(
              host,
              response.isTimedOut ? HostStatusEnum.Timeouted : HostStatusEnum.Down
            )
          ),
        ]).then(() => retry(hosts, getTimeout));
      },
      onFail(response) {
        throw deserializeFailure(response);
      },
    };

    return transporter.requester.send(payload).then(response => {
      return retryDecision(response, decisions);
    });
  };

  /**
   * Finally, for each retryable host perform request until we got a non
   * retryable response. Some notes here:
   *
   * 1. The reverse here is applied so we can apply a `pop` later on => more performant.
   * 2. We also get from the retryable options a timeout multiplier that is tailored
   * for the current context.
   */
  return createRetryableOptions(transporter.hostsCache, statelessHosts).then(options => {
    return retry([...options.statelessHosts].reverse(), options.getTimeout);
  });
}
