#!/usr/bin/env tsx
/**
 * TASK-020: DRM Protocol v2 CLI Tool
 * 
 * Command-line tool for managing DRM server keys and testing protocol.
 * 
 * Usage:
 *   pnpm drm:keygen              # Generate server signing key
 *   pnpm drm:test-installation   # Test installation flow
 *   pnpm drm:test-activation     # Test license activation
 */

import { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { 
  createServerSigningKey,
  rotateServerSigningKey,
  generateInstallationKeypair,
  generateNonce
} from '../lib/drm';

const program = new Command();

program
  .name('drm-cli')
  .description('CLI tool for DRM v2 protocol management')
  .version('1.0.0');

// Rotate the server signing key (PLAN G-007)
program
  .command('rotate')
  .description('Rotate the server signing key (old key becomes PREVIOUS, still trusted)')
  .option('--output <path>', 'Output directory for the new private key', '.keys')
  .action(async (options) => {
    try {
      console.log('🔑 Rotating DRM server signing key...');

      const result = await rotateServerSigningKey();

      console.log('✅ Rotation complete. New ACTIVE key id:', result.keyId);
      console.log('⚠️  Install the new private key into DRM_SERVER_PRIVATE_KEY and restart the server.');
      console.log('   The PREVIOUS key remains trusted for verification of existing leases.');

      const { writeFile, mkdir } = await import('fs/promises');
      const { join } = await import('path');
      await mkdir(options.output, { recursive: true });
      const keyPath = join(options.output, `drm-server-key-${result.keyId}.txt`);
      await writeFile(keyPath, result.privateKey, { mode: 0o600 });
      console.log(`💾 New private key written once to ${keyPath} (0600). Delete it after installing into the environment.`);
      process.exit(0);
    } catch (error) {
      console.error('❌ Rotation failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Generate server signing keypair
program
  .command('keygen')
  .description('Generate Ed25519 server signing keypair')
  .option('--output <path>', 'Output directory for private key', '.keys')
  .action(async (options) => {
    try {
      console.log('🔑 Generating DRM server signing keypair...');
      
      const result = await createServerSigningKey();
      
      console.log('✅ Server key generated successfully!');
      console.log(`📋 Key ID: ${result.keyId}`);
      console.log(`🔓 Public Key: ${result.publicKey.substring(0, 20)}...`);
      
      // Save private key to file
      const keyFile = join(process.cwd(), options.output, 'drm-server.key');
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
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Test installation keypair generation
program
  .command('test-installation')
  .description('Test installation keypair generation')
  .action(async () => {
    try {
      console.log('🧪 Testing installation keypair generation...');
      
      // Generate installation keypair
      const keypair = generateInstallationKeypair();
      
      console.log('✅ Installation keypair generated!');
      console.log(`🔓 Public Key: ${keypair.publicKey.substring(0, 40)}...`);
      console.log(`🔐 Private Key: ${keypair.privateKey.substring(0, 40)}... (client-side only)`);
      
      // Save for testing
      const testFile = join(process.cwd(), '.keys', 'test-installation.key');
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
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Generate nonce for testing
program
  .command('generate-nonce')
  .description('Generate random nonce for testing')
  .action(() => {
    const nonce = generateNonce();
    console.log('🎲 Generated nonce:');
    console.log(nonce);
    console.log('');
    console.log('Use this in lease activation request.');
  });

// Show protocol info
program
  .command('info')
  .description('Show DRM protocol information')
  .action(() => {
    console.log('📖 DRM Protocol v2 Information');
    console.log('');
    console.log('Protocol Version: 2');
    console.log('Cryptography: Ed25519 (asymmetric)');
    console.log('Key Size: 256 bits');
    console.log('Signature Size: 512 bits');
    console.log('');
    console.log('Endpoints:');
    console.log('  GET  /drm/v2/public-key                      - Get server public key');
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
  });

program.parse();
