const fs = require('fs');
const path = require('path');

// 設定: バージョンを更新するファイルとその正規表現
const filesToUpdate = [
    {
        path: 'index.html',
        patterns: [
            {
                regex: /(<span\b[^>]*class="version-badge"[^>]*>)v([\d.]+)(<\/span>)/,
                replace: '$1v$VERSION$3'
            }
        ]
    },
    {
        path: 'app.js',
        patterns: [
            {
                regex: /const APP_VERSION = '([\d.]+)';/,
                replace: "const APP_VERSION = '$VERSION';"
            }
        ]
    },
    {
        path: 'sw.js',
        patterns: [
            {
                regex: /const CACHE_NAME = 'inventory-app-v(\d+)';/,
                replace: (match, p1) => {
                    // newVersion is available in the outer scope
                    const cacheVersion = currentNewVersion.split('.').pop();
                    return `const CACHE_NAME = 'inventory-app-v${cacheVersion}';`;
                }
            }
        ]
    }
];

let currentNewVersion = '';

function bumpVersion(newVersion, projectRoot) {
    console.log(`Bumping version to ${newVersion}...`);
    currentNewVersion = newVersion;

    filesToUpdate.forEach(fileDef => {
        const fullPath = path.join(projectRoot, fileDef.path);
        if (!fs.existsSync(fullPath)) {
            console.warn(`File not found: ${fullPath}`);
            return;
        }

        let content = fs.readFileSync(fullPath, 'utf8');
        let modified = false;

        fileDef.patterns.forEach(p => {
            const oldContent = content;
            if (typeof p.replace === 'function') {
                content = content.replace(p.regex, (match, ...args) => p.replace(match, ...args, newVersion));
            } else {
                const replacement = p.replace.replace('$VERSION', newVersion);
                content = content.replace(p.regex, replacement);
            }
            if (oldContent !== content) modified = true;
        });

        if (modified) {
            fs.writeFileSync(fullPath, content, 'utf8');
            console.log(`Updated ${fileDef.path}`);
        } else {
            console.log(`No changes needed for ${fileDef.path}`);
        }
    });
}

// CLI引数からバージョンを取得
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node bump-version.js <new_version> <project_root>');
    process.exit(1);
}

bumpVersion(args[0], args[1]);
