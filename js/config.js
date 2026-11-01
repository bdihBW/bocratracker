'use strict';
/* Live connection. With these set, the tracker runs against Supabase; remove them (or set
   BDIH_LIVE = null) to run the browser-only demo instead. Both values are public by design:
   access is controlled by sign-in and Row Level Security, not by keeping the key secret. */
window.BDIH_LIVE = {
  url: 'https://qkkbfwfyuucptjgfoufx.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFra2Jmd2Z5dXVjcHRqZ2ZvdWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NTQzMDEsImV4cCI6MjEwOTEzMDMwMX0.5nigNT0bC_2CKBJSTn_8PIJTWbjI5i65YMO51xrQd94'
};
// Open the page with ?demo to use the browser-only demo even when the live connection is set
if (/[?&]demo\b/.test(location.search)) window.BDIH_LIVE = null;
