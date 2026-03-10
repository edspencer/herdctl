import type { CommandContext, SlashCommand } from "./types.js";

export const skillsCommand: SlashCommand = {
  name: "skills",
  description: "List discovered skills for this agent",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, commandActions, agentName } = context;
    const skills = commandActions?.listSkills ? await commandActions.listSkills() : [];

    if (skills.length === 0) {
      await interaction.reply({
        content: "No skills were discovered for this agent.",
        ephemeral: true,
      });
      return;
    }

    const lines = skills.slice(0, 25).map((skill) => {
      const detail = skill.description ? ` — ${skill.description}` : "";
      return `• \`${skill.name}\`${detail}`;
    });

    await interaction.reply({
      embeds: [
        {
          description: [`Discovered **${skills.length}** skill(s):`, "", ...lines].join("\n"),
          color: 0x3b82f6,
          footer: { text: `herdctl · ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
