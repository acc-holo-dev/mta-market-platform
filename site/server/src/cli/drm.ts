#!/usr/bin/env tsx
/**
 * DRM Protocol v2 CLI Tool.
 *
 * Command-line tool for managing DRM server keys and testing the protocol.
 * Arguments are parsed manually — the CLI surface is small and stable, so
 * the extra dependency is not justified (PLAN-019 A-006).
 *
 * Usage:
 *   pnpm drm:keygen              # Generate server signing key
 *   pnpm drm:rotate              # Rotate the server signing key
 *   pnpm drm:test-installation   # Test installation flow
 *   pnpm drm:generate-nonce      # Random nonce for activation testing
 *   pnpm drm:info                # Protocol reference
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
  createServerSigningKey,
  rotateServerSigningKey,
  generateInstallationKeypair,
  generateNonce
} from '../lib/drm/index.js';

interface Args {
  command: string;
  options: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const [command = 'info'] = argv.filter((a) => !a.startsWith('-'));
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output') options.output = argv[i + 1] ?? '.keys';
  }
  return { command, options };
}

async function rotate(outputDir: string): Promise<void> {
  try {
    console.log('🔑 Rotating DRM server signing key...');

    const result = await rotateServerSigningKey();

    console.log('✅ Rotation complete. New ACTIVE key id:', result.keyId);
    console.log('⚠️  Install the new private key into DRM_SERVER_PRIVATE_KEY and restart the server.');
    console.log('   The PREVIOUS key remains trusted for verification of existing leases.');

    await mkdir(outputDir, { recursive: true });
    const keyPath = join(outputDir, `drm-server-key-${result.keyId}.txt`);
    await writeFile(keyPath, result.privateKey, { mode: 0o600 });
    console.log(`💾 New private key written once to ${keyPath} (0600). Delete it after installing into the environment.`);
    process.exit(0);
  } catch (error) {
    console.error('✌ Rotation failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function keygen(outputDir: string): Promise<void> {
  try {
    console.log('🔑 Generating DRM server signing keypair...');

    const result = await createServerSigningKey();

    console.log('✅ Server key generated successfully!');
    console.log(`📋 Key ID: ${result.keyId}`);
    console.log(`🔓 Public Key: ${result.publicKey.substring(0, 20)}...`);

    const keyFile = join(process.cwd(), outputDir, 'drm-server.key');
    await writeFile(keyFile, JSON.stringify({
      keyId: result.keyId,
      publicKey: result.publicKey,
      privateKey: result.privateKey,
      createdAt: new Date().toISOString()
    }, null, 2));

    console.log(`🔐 Private key saved to: ${keyFile}`);
    console.log('');
    console.log('⚠️  IMPORTANT: Configure environment variable!');
    console.log(`   export DRM_SERVER_PRIVATE_KEY="${result.privateKey}"`);
    console.log('');
    console.log('   Or add to .env:');
    console.log(`   DRM_SERVER_PRIVATE_KEY="${result.privateKey}"`);
  } catch (error) {
    console.error('✌ Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function testInstallation(): Promise<void> {
  try {
    console.log('🧪 Testing installation keypair generation...');

    const keypair = generateInstallationKeypair();

    console.log('✅ Installation keypair generated!');
    console.log(`🔓 Public Key: ${keypair.publicKey.substring(0, 40)}...`);
    console.log(`🔐 Private Key: ${keypair.privateKey.substring(0, 40)}... (client-side only)`);

    const testFile = join(process.cwd(), '.keys', 'test-installation.key');
    await mkdir(join(process.cwd(), '.keys'), { recursive: true });
    await writeFile(testFile, JSON.stringify({
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      createdAt: new Date().toISOString(),
      note: 'Test installation keypair - for development only'
    }, null, 2));

    console.log(`💾 Test keypair saved to: ${testFile}`);
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Register installation: POST /drm/v2/installations');
    console.log('      Body: { "publicKey": "...", "mtaVersion": "1.5.9", "moduleVersion": "0.5.0" }');
    console.log('   2. Sign challenge with privateKey');
    console.log('   3. Verify: POST /drm/v2/installations/:id/verify');
  } catch (error) {
    console.error('✌ Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function generateNonceCommand(): void {
  const nonce = generateNonce();
  console.log('🎲 Generated nonce:');
  console.log(nonce);
  console.log('');
  console.log('Use this in lease activation request.');
}

function info(): void {
  console.log('📖 DRM Protocol v2 Information');
  console.log('');
  console.log('Protocol Version: 2');
  console.log('Cryptography: Ed25519 (asymmetric)');
  console.log('Key Size: 256 bits');
  console.log('Signature Size: 512 bits');
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /drm/v2/public-keys                    - Trusted server key set');
  console.log('  POST /drm/v2/installations                   - Register installation');
  console.log('  POST /drm/v2/installations/:id/verify        - Verify challenge');
  console.log('  POST /drm/v2/activate                        - Activate license');
  console.log('  POST /drm/v2/heartbeat                       - Send heartbeat');
  console.log('  GET  /drm/v2/leases/:installationId/:resourceId - Get active lease');
  console.log('');
  console.log('Protocol Flow:');
  console.log('  1. Client generates Ed25519 keypair (client-side)');
  console.log('  2. Client → POST /drm/v2/installations { publicKey, ... }');
  console.log('  3. Server → { installationId, challenge }');
  console.log('  4. Client signs challenge with privateKey');
  console.log('  5. Client → POST /drm/v2/installations/:id/verify { challengeResponse }');
  console.log('  6. Server verifies signature');
  console.log('  7. Client → POST /drm/v2/activate { licenseId, installationId, nonce }');
  console.log('  8. Server → signed lease');
  console.log('  9. Client verifies lease signature with server publicKey');
  console.log(' 10. Client runs resource if lease valid');
}

const { command, options } = parseArgs(process.argv.slice(2));

switch (command) {
  case 'rotate':
    void rotate(options.output ?? '.keys');
    break;
  case 'keygen':
    void keygen(options.output ?? '.keys');
    break;
  case 'test-installation':
    void testInstallation();
    break;
  case 'generate-nonce':
    generateNonceCommand();
    break;
  case 'info':
  default:
    if (command !== 'info') {
      console.error(`Unknown command: ${command}. Available: rotate | keygen | test-installation | generate-nonce | info`);
      process.exit(1);
    }
    info();
    break;
}
