export type ClubRole = 'super_admin' | 'admin' | 'moderator' | 'secretary' | 'member';
export interface AuthUser { id: string; token:string; email?: string; role: ClubRole; fullName: string }
