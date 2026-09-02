export type TenantScoped = { tenantId?: string };

export type LeadStatus =
  | "discovered"
  | "qualified"
  | "disqualified"
  | "dm_sent"
  | "replied"
  | "handed_off"
  | "converted"
  | "do_not_contact";

export interface Lead extends TenantScoped {
  id: string;
  ig_username: string;
  ig_user_id: string | null;
  full_name: string | null;
  bio: string | null;
  followers_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  profile_pic_url: string | null;
  niche: string;
  score: number;
  score_reason: string | null;
  qualified_at: Date | null;
  status: LeadStatus;
  do_not_contact: boolean;
  source: string | null;
  discovered_at: Date;
  updated_at: Date;
}

export interface CampaignConfig extends TenantScoped {
  id: string;
  niche: string;
  icp_description: string;
  icp_hashtags: string[];
  icp_competitors: string[];
  product_name: string;
  product_url: string | null;
  verified_claims: string[];
  dm_template_1: string;
  dm_template_followup: string | null;
  whatsapp_number: string;
  max_dm_per_day: number;
  window_start_hour: number;
  window_end_hour: number;
  min_score_to_dm: number;
  followup_after_hours: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type JobKind =
  | "prospect"
  | "qualify"
  | "outreach"
  | "followup"
  | "inbox_poll"
  | "handoff";

export interface Job<T = Record<string, unknown>> extends TenantScoped {
  id: string;
  kind: JobKind;
  payload: T;
  status: "pending" | "running" | "done" | "failed" | "dead";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: Date;
  created_at: Date;
  updated_at: Date;
}

export interface InstagramProfile extends TenantScoped {
  username: string;
  fullName: string;
  bio: string;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  profilePicUrl: string | null;
  recentPosts: string[];
}
