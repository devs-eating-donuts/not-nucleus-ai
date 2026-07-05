import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { effectivePersonaName } from '../../shared/personas';
import { ALL_ROLE_IDS, isRoleId } from '../../shared/roles';
import type { AppSettings } from '../../shared/settings';
import type { RoleId } from '../../shared/roles';
import { validateRoleConfiguration } from '../services/cliValidator';
import { settingsStore } from '../services/settingsStore';

/**
 * Validation IPC. Configurations are read from the settings store — the
 * main process validates what is actually persisted, never a payload the
 * renderer claims is the configuration. The persona name shown in results
 * follows the persisted naming mode.
 */
function validateOne(settings: AppSettings, roleId: RoleId) {
  const config = settings.roles[roleId];
  const displayName = effectivePersonaName(roleId, config.personaNameOverride, settings.namingMode);
  return validateRoleConfiguration(config, displayName);
}

export function registerValidationHandlers(): void {
  ipcMain.handle(IpcChannels.validationValidateAll, async () => {
    const settings = await settingsStore.get();
    return Promise.all(ALL_ROLE_IDS.map((roleId) => validateOne(settings, roleId)));
  });

  ipcMain.handle(IpcChannels.validationValidateRole, async (_event, roleId: unknown) => {
    if (!isRoleId(roleId)) {
      throw new Error(`validation:validate-role received an unknown role id: ${String(roleId)}`);
    }
    const settings = await settingsStore.get();
    return validateOne(settings, roleId);
  });
}
