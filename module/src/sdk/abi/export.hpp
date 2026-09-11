#pragma once

// MTA entry-point exports. The server resolves these names via
// LoadLibrary/dlsym when loading the module.

#ifndef MTAEXPORT
#if defined(_WIN32)
#define MTAEXPORT extern "C" __declspec(dllexport)
#else
#define MTAEXPORT extern "C" __attribute__((visibility("default")))
#endif
#endif
