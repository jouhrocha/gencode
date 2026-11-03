/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from '../../../base/common/path.js';
import { UpdateType } from '../common/update.js';

export function isInnoSetupInstall(target: string | undefined): boolean {
	return target === 'user' || target === 'system';
}

export function getWin32UpdateType(target: string | undefined): UpdateType {
	if (isInnoSetupInstall(target)) {
		return UpdateType.Setup;
	} else if (path.basename(path.normalize(path.join(process.execPath, '..', '..'))) === 'Program Files') {
		return UpdateType.WindowsInstaller;
	} else {
		return UpdateType.Archive;
	}
}
