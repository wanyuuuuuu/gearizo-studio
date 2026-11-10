-- Gearizo: remind marketing when a scheduled post is due (replace the key with your GZ_HOOK_SECRET)
-- Runs every minute; the notify function only sends one reminder per post.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'gearizo-postdue';
select cron.schedule('gearizo-postdue', '* * * * *', $cron$
  select net.http_post(
    url := 'https://ffuzrcjklnsepshbyswm.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-gz-secret', '<your GZ_HOOK_SECRET>'),
    body := '{"action": "postdue"}'::jsonb);
$cron$);
