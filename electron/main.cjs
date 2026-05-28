const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const iconPath = path.join(__dirname, '../build/icon.ico');
const appDataFolderName = 'FH6 TuneLab';
const legacyAppDataFolderName = 'forza-horizon-6-tuning-tool';

app.setName(appDataFolderName);

function fh6DataStorePath() {
  return path.join(app.getPath('appData'), appDataFolderName, 'data', 'fh6-data.json');
}

function legacyFH6DataStorePath() {
  return path.join(app.getPath('appData'), legacyAppDataFolderName, 'data', 'fh6-data.json');
}

async function readFH6DataStore() {
  const dataPath = fh6DataStorePath();

  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return { ok: true, path: dataPath, data: JSON.parse(raw) };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const legacyPath = legacyFH6DataStorePath();

      try {
        const raw = await fs.readFile(legacyPath, 'utf8');
        const data = JSON.parse(raw);
        const migration = await writeFH6DataStore(data);

        return {
          ok: true,
          path: dataPath,
          data,
          migratedFrom: legacyPath,
          migrationError: migration.ok ? undefined : migration.error,
        };
      } catch (legacyError) {
        if (!legacyError || legacyError.code !== 'ENOENT') {
          return {
            ok: false,
            path: dataPath,
            error: legacyError instanceof Error ? legacyError.message : String(legacyError),
          };
        }
      }

      return { ok: true, path: dataPath, data: null };
    }

    return { ok: false, path: dataPath, error: error instanceof Error ? error.message : String(error) };
  }
}

async function writeFH6DataStore(data) {
  const dataPath = fh6DataStorePath();
  const dataDir = path.dirname(dataPath);
  const tempPath = `${dataPath}.tmp`;

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, dataPath);
    return { ok: true, path: dataPath };
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // Best effort cleanup only.
    }

    return { ok: false, path: dataPath, error: error instanceof Error ? error.message : String(error) };
  }
}

function safeSetupFileName(fileName) {
  const fallback = 'FH6 TuneLab Setup.exe';
  const cleaned = String(fileName || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim();

  return cleaned.toLowerCase().endsWith('.exe') ? cleaned : fallback;
}

async function downloadUpdateSetup(url, fileName) {
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Update setup must use HTTPS.');
  }

  const response = await fetch(parsedUrl, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'FH6-TuneLab-Updater',
    },
  });

  if (!response.ok) {
    throw new Error(`Setup download failed (${response.status})`);
  }

  const updateDir = path.join(app.getPath('temp'), 'FH6 TuneLab Updates');
  await fs.mkdir(updateDir, { recursive: true });

  const setupPath = path.join(updateDir, safeSetupFileName(fileName));
  const data = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(setupPath, data);

  return setupPath;
}

ipcMain.handle('fh6-data:load', async () => readFH6DataStore());

ipcMain.handle('fh6-data:save', async (event, data) => writeFH6DataStore(data));

ipcMain.handle('update:download-and-install', async (event, request) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const url = typeof request?.url === 'string' ? request.url : '';
  const fileName = safeSetupFileName(request?.fileName);

  if (!url) {
    return { ok: false, error: 'No setup asset found for this release.' };
  }

  const decision = await dialog.showMessageBox(parent ?? undefined, {
    type: 'question',
    buttons: ['Download and install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'FH6 TuneLab Update',
    message: 'Download and install the new FH6 TuneLab update?',
    detail: 'The setup will be downloaded to a temporary folder, launched, and this app will close so the installer can update it.',
  });

  if (decision.response !== 0) {
    return { ok: false, skipped: true };
  }

  try {
    const setupPath = await downloadUpdateSetup(url, fileName);
    const launchError = await shell.openPath(setupPath);

    if (launchError) {
      throw new Error(launchError);
    }

    setTimeout(() => app.quit(), 1200);
    return { ok: true, path: setupPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 720,
    minHeight: 620,
    backgroundColor: '#0c1117',
    title: 'Forza Horizon 6 Tuning Tool',
    icon: iconPath,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0c1117',
      symbolColor: '#f2f6f8',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
