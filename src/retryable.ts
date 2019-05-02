
import { Response } from './index';

export enum XhrFailures {
	Status = 0,
	Error = 1,
	Abort = 2,
	Timeout = 3
}

export interface IsRetryableCallback {
	(xhr: XMLHttpRequest, cause: XhrFailures, res?: Response): boolean;
}

export const retryNetworkErrors = (xhr: XMLHttpRequest, cause: XhrFailures) : boolean => {
	return cause === XhrFailures.Timeout || cause === XhrFailures.Error;
}
