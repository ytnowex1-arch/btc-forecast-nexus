export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      bot_config: {
        Row: {
          created_at: string
          current_balance: number
          id: string
          initial_balance: number
          interval: string
          is_active: boolean
          leverage: number
          name: string
          position_size_pct: number
          stop_loss_pct: number
          strategy: string
          symbol: string
          take_profit_pct: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          interval?: string
          is_active?: boolean
          leverage?: number
          name?: string
          position_size_pct?: number
          stop_loss_pct?: number
          strategy?: string
          symbol?: string
          take_profit_pct?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          interval?: string
          is_active?: boolean
          leverage?: number
          name?: string
          position_size_pct?: number
          stop_loss_pct?: number
          strategy?: string
          symbol?: string
          take_profit_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      bot_logs: {
        Row: {
          bot_config_id: string | null
          created_at: string
          data: Json | null
          id: string
          level: string
          message: string
        }
        Insert: {
          bot_config_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          level?: string
          message: string
        }
        Update: {
          bot_config_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          level?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_logs_bot_config_id_fkey"
            columns: ["bot_config_id"]
            isOneToOne: false
            referencedRelation: "bot_config"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_positions: {
        Row: {
          bot_config_id: string | null
          closed_at: string | null
          entry_price: number
          entry_reason: string | null
          exit_price: number | null
          exit_reason: string | null
          id: string
          leverage: number
          margin_used: number
          opened_at: string
          pnl: number | null
          pnl_pct: number | null
          quantity: number
          side: string
          status: string
          stop_loss: number | null
          take_profit: number | null
        }
        Insert: {
          bot_config_id?: string | null
          closed_at?: string | null
          entry_price: number
          entry_reason?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          leverage?: number
          margin_used: number
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          quantity: number
          side: string
          status?: string
          stop_loss?: number | null
          take_profit?: number | null
        }
        Update: {
          bot_config_id?: string | null
          closed_at?: string | null
          entry_price?: number
          entry_reason?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          leverage?: number
          margin_used?: number
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          quantity?: number
          side?: string
          status?: string
          stop_loss?: number | null
          take_profit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_positions_bot_config_id_fkey"
            columns: ["bot_config_id"]
            isOneToOne: false
            referencedRelation: "bot_config"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_trades: {
        Row: {
          action: string
          balance_after: number | null
          bot_config_id: string | null
          created_at: string
          id: string
          indicators_snapshot: Json | null
          pnl: number | null
          position_id: string | null
          price: number
          quantity: number
          reason: string | null
        }
        Insert: {
          action: string
          balance_after?: number | null
          bot_config_id?: string | null
          created_at?: string
          id?: string
          indicators_snapshot?: Json | null
          pnl?: number | null
          position_id?: string | null
          price: number
          quantity: number
          reason?: string | null
        }
        Update: {
          action?: string
          balance_after?: number | null
          bot_config_id?: string | null
          created_at?: string
          id?: string
          indicators_snapshot?: Json | null
          pnl?: number | null
          position_id?: string | null
          price?: number
          quantity?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_trades_bot_config_id_fkey"
            columns: ["bot_config_id"]
            isOneToOne: false
            referencedRelation: "bot_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_trades_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "bot_positions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
